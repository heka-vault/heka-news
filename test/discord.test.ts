import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import { discordLinkFor, linkDiscord } from '../src/db/discord.ts'
import { accountByLogin } from '../src/db/users.ts'
import { signDiscordState, verifyDiscordState } from '../src/lib/discord.ts'
import {
  type AppFixture,
  fakeDiscord,
  type Member,
  makeApp,
  NOW,
  ORIGIN,
  SECRET,
  signIn,
} from './helpers.ts'

const DISCORD_USER = { id: '123456789012345678', username: 'quiet.fox' }

/** Start linking as `member` and follow Discord back to the callback, in one browser. */
async function linkWithDiscord(
  member: Member,
  opts: { code?: string; state?: (state: string) => string; cookie?: string | null } = {},
) {
  const start = await member.get('/auth/discord')
  const location = new URL(start.headers.get('Location') ?? '')
  const state = location.searchParams.get('state') ?? ''
  const nonce = start.headers
    .getSetCookie()
    .find((c) => c.startsWith('heka_discord_oauth='))
    ?.split(';')[0]
  const cookie = opts.cookie === null ? member.cookie : `${member.cookie}; ${opts.cookie ?? nonce}`
  const query = new URLSearchParams({
    code: opts.code ?? 'good',
    state: opts.state ? opts.state(state) : state,
  })
  const callback = await member.get(`/auth/discord/callback?${query}`, { cookie })
  return { start, location, callback }
}

function linkingApp(user = DISCORD_USER): { fx: AppFixture; calls: { revoked: string[] } } {
  const discord = fakeDiscord(user)
  const fx = makeApp({ discord: discord.client })
  return { fx, calls: discord.calls }
}

describe('Discord config', () => {
  test('linking needs both values, and SESSION_SECRET in production', () => {
    expect(loadConfig({ DISCORD_CLIENT_ID: 'id' }).discord).toBeNull()
    expect(
      loadConfig({ DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 's', NODE_ENV: 'production' })
        .discord,
    ).toBeNull()
    expect(
      loadConfig({
        DISCORD_CLIENT_ID: 'id',
        DISCORD_CLIENT_SECRET: 's',
        NODE_ENV: 'production',
        SESSION_SECRET: 'x',
      }).discord,
    ).toEqual({ clientId: 'id', clientSecret: 's' })
  })
})

describe('Discord state', () => {
  test('signed, bound to a member, and expires', () => {
    const token = signDiscordState(SECRET, { nonce: 'n', userId: 7, exp: NOW + 60 })
    expect(verifyDiscordState(SECRET, token, NOW)).toEqual({ nonce: 'n', userId: 7, exp: NOW + 60 })
    expect(verifyDiscordState(SECRET, token, NOW + 61)).toBeNull()
    expect(verifyDiscordState('other', token, NOW)).toBeNull()
    const sig = token.split('.')[1]
    const forged = Buffer.from(JSON.stringify({ nonce: 'n', userId: 8, exp: NOW + 60 })).toString(
      'base64url',
    )
    expect(verifyDiscordState(SECRET, `${forged}.${sig}`, NOW)).toBeNull()
  })
})

describe('Linking Discord', () => {
  test('settings hide the section until the Discord app is configured', async () => {
    const fx = makeApp()
    const html = await (await signIn(fx, 'quietfox').get('/settings')).text()
    expect(html).not.toContain('discord-heading')
  })

  test('settings offer to connect, with what it means', async () => {
    const { fx } = linkingApp()
    const html = await (await signIn(fx, 'quietfox').get('/settings')).text()
    expect(html).toContain('href="/auth/discord"')
    expect(html).toContain('#heka-news-threads')
    expect(html).toContain('via Discord')
  })

  test('starting needs a member', async () => {
    const { fx } = linkingApp()
    const res = await fx.get('/auth/discord')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/signin?next=%2Fsettings')
  })

  test('the whole flow links the account, drops the token, and shows it on the profile', async () => {
    const { fx, calls } = linkingApp()
    const member = signIn(fx, 'quietfox')
    const { location, callback } = await linkWithDiscord(member)
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/discord/callback`)
    expect(callback.status).toBe(303)
    expect(callback.headers.get('Location')).toBe('/settings?discord=linked#discord-heading')
    expect(calls.revoked).toEqual(['token-for-good'])
    expect(discordLinkFor(fx.db, member.id)).toMatchObject({
      discordId: DISCORD_USER.id,
      username: 'quiet.fox',
    })

    const settings = await (await member.get('/settings?discord=linked')).text()
    expect(settings).toContain('Discord is connected.')
    expect(settings).toContain('Disconnect Discord')
    const profile = await (await fx.get('/u/quietfox')).text()
    expect(profile).toContain(`https://discord.com/users/${DISCORD_USER.id}`)
    expect(profile).toContain('quiet.fox')
  })

  test('a callback without the nonce cookie is refused', async () => {
    const { fx } = linkingApp()
    const member = signIn(fx, 'quietfox')
    const { callback } = await linkWithDiscord(member, { cookie: null })
    expect(callback.status).toBe(400)
    expect(discordLinkFor(fx.db, member.id)).toBeNull()
  })

  test("a state started by another member does not link this member's session", async () => {
    const { fx } = linkingApp()
    const attacker = signIn(fx, 'oxbow')
    const victim = signIn(fx, 'quietfox')
    const started = await linkWithDiscord(attacker, { code: 'bad' })
    const state = started.location.searchParams.get('state') ?? ''
    const nonce = started.start.headers
      .getSetCookie()
      .find((c) => c.startsWith('heka_discord_oauth='))
      ?.split(';')[0]
    const res = await victim.get(`/auth/discord/callback?code=good&state=${state}`, {
      cookie: `${victim.cookie}; ${nonce}`,
    })
    expect(res.status).toBe(400)
    expect(discordLinkFor(fx.db, victim.id)).toBeNull()
  })

  test('a code Discord refuses is a friendly failure', async () => {
    const { fx } = linkingApp()
    const { callback } = await linkWithDiscord(signIn(fx, 'quietfox'), { code: 'bad' })
    expect(callback.status).toBe(400)
    expect(await callback.text()).toContain('Discord did not connect')
  })

  test('cancelling on Discord changes nothing', async () => {
    const { fx } = linkingApp()
    const member = signIn(fx, 'quietfox')
    const res = await member.get('/auth/discord/callback?error=access_denied')
    expect(res.headers.get('Location')).toBe('/settings?discord=cancelled#discord-heading')
    expect(discordLinkFor(fx.db, member.id)).toBeNull()
  })

  test('one Discord account belongs to one member', async () => {
    const { fx } = linkingApp()
    const other = accountByLogin(fx.db, 'oxbow')
    if (!other) throw new Error('no oxbow')
    linkDiscord(fx.db, other.id, { discordId: DISCORD_USER.id, username: 'quiet.fox' }, NOW)
    const member = signIn(fx, 'quietfox')
    const { callback } = await linkWithDiscord(member)
    expect(callback.status).toBe(409)
    expect(discordLinkFor(fx.db, member.id)).toBeNull()
  })

  test('linking again replaces the account', async () => {
    let user = DISCORD_USER
    const discord = fakeDiscord(() => user)
    const fx = makeApp({ discord: discord.client })
    const member = signIn(fx, 'quietfox')
    await linkWithDiscord(member)
    user = { id: '999', username: 'fox.two' }
    await linkWithDiscord(member)
    expect(discordLinkFor(fx.db, member.id)).toMatchObject({
      discordId: '999',
      username: 'fox.two',
    })
  })

  test('disconnecting needs the CSRF token, then removes the link', async () => {
    const { fx } = linkingApp()
    const member = signIn(fx, 'quietfox')
    await linkWithDiscord(member)
    const forged = await member.post('/settings/discord/unlink', {}, { csrf: 'nope' })
    expect(forged.status).toBe(403)
    expect(discordLinkFor(fx.db, member.id)).not.toBeNull()
    const res = await member.post('/settings/discord/unlink')
    expect(res.headers.get('Location')).toBe('/settings?discord=unlinked#discord-heading')
    expect(discordLinkFor(fx.db, member.id)).toBeNull()
    expect(await (await fx.get('/u/quietfox')).text()).not.toContain('discord.com/users')
  })
})
