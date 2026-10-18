import { describe, expect, test } from 'bun:test'
import { loadConfig, RULES } from '../src/config.ts'
import { createInvite } from '../src/db/invites.ts'
import { countSessions } from '../src/db/sessions.ts'
import { accountByLogin, getProfile } from '../src/db/users.ts'
import { createUser } from '../src/db/write.ts'
import { sha256Hex } from '../src/lib/crypto.ts'
import {
  type GitHubProfile,
  pkceChallenge,
  pkceVerifier,
  signState,
  verifyState,
} from '../src/lib/oauth.ts'
import { csrfToken, sameOrigin, serializeCookie } from '../src/lib/session.ts'
import { type AppFixture, fakeGitHub, makeApp, NOW, ORIGIN, SECRET, signIn } from './helpers.ts'

const GITHUB_ENV = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', MODERATORS: 'Founder' }

function profile(login: string, id: number, name: string | null = null): GitHubProfile {
  return { id, login, name, avatarUrl: `https://avatars.example.test/${id}` }
}

/** Run the whole GitHub flow in one browser: start, follow to the callback, return the result. */
async function signInWithGitHub(
  fx: AppFixture,
  opts: { invite?: string; next?: string; code?: string; cookie?: string } = {},
) {
  const query = new URLSearchParams()
  if (opts.invite) query.set('invite', opts.invite)
  if (opts.next) query.set('next', opts.next)
  const start = await fx.app.request(`/auth/github?${query}`, {
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  })
  expect(start.status).toBe(302)
  const location = new URL(start.headers.get('Location') ?? '')
  const state = location.searchParams.get('state') ?? ''
  const nonceCookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
  const cookie = [nonceCookie, opts.cookie].filter(Boolean).join('; ')
  const callback = await fx.app.request(
    `/auth/github/callback?code=${opts.code ?? 'good'}&state=${encodeURIComponent(state)}`,
    { headers: { cookie } },
  )
  return { start, location, state, callback }
}

function sessionToken(res: Response): string | null {
  const cookies = res.headers.getSetCookie()
  const session = cookies.find((c) => c.startsWith('heka_session=') && !c.includes('Max-Age=0'))
  return session ? (session.split(';')[0]?.slice('heka_session='.length) ?? null) : null
}

describe('OAuth state', () => {
  const state = { nonce: 'n', next: '/x', invite: null, exp: NOW + 600 }

  test('a signed state verifies and round-trips', () => {
    expect(verifyState(SECRET, signState(SECRET, state), NOW)).toEqual(state)
  })

  test('a tampered state is refused', () => {
    const token = signState(SECRET, state)
    const [body, sig] = token.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({ ...state, next: '/evil' })).toString('base64url')
    expect(verifyState(SECRET, `${forged}.${sig}`, NOW)).toBeNull()
    expect(verifyState(SECRET, `${body}.${sig.slice(0, -2)}xx`, NOW)).toBeNull()
    expect(verifyState('another-secret', token, NOW)).toBeNull()
    expect(verifyState(SECRET, 'not-a-state', NOW)).toBeNull()
  })

  test('an expired state is refused', () => {
    expect(verifyState(SECRET, signState(SECRET, state), NOW + 601)).toBeNull()
  })

  test('the PKCE verifier needs the secret and the challenge is S256', () => {
    const verifier = pkceVerifier(SECRET, 'nonce')
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pkceVerifier('other', 'nonce')).not.toBe(verifier)
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('the authorize redirect carries state, the S256 challenge and our callback', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('x', 1)).client })
    const { location } = await signInWithGitHub(fx)
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/github/callback`)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('a callback in a browser without the nonce cookie is refused', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('Founder', 1)).client })
    const start = await fx.app.request('/auth/github')
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state') ?? ''
    const res = await fx.app.request(`/auth/github/callback?code=good&state=${state}`)
    expect(res.status).toBe(400)
    expect(sessionToken(res)).toBeNull()
  })

  test('an expired state at the callback is refused', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('Founder', 1)).client })
    const start = await fx.app.request('/auth/github')
    const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state') ?? ''
    const cookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
    fx.advance(RULES.oauthStateTtl + 1)
    const res = await fx.app.request(`/auth/github/callback?code=good&state=${state}`, {
      headers: { cookie },
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Signing in did not work')
  })

  test('the code is exchanged with the PKCE verifier and the token revoked, never stored', async () => {
    const github = fakeGitHub(profile('Founder', 77))
    const fx = makeApp({ env: GITHUB_ENV, github: github.client })
    const { callback, state } = await signInWithGitHub(fx)
    expect(callback.status).toBe(303)
    const nonce = verifyState(SECRET, state, fx.now())?.nonce ?? ''
    expect(github.calls.exchanges).toEqual([
      { code: 'good', verifier: pkceVerifier(SECRET, nonce) },
    ])
    expect(github.calls.revoked).toEqual(['token-for-good'])
    const dump = JSON.stringify(fx.db.query('SELECT * FROM users').all())
    expect(dump).not.toContain('token-for-good')
  })

  test('GitHub refusing the code changes nothing', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('Founder', 1)).client })
    const { callback } = await signInWithGitHub(fx, { code: 'bad' })
    expect(callback.status).toBe(400)
    expect(accountByLogin(fx.db, 'Founder')).toBeNull()
  })
})

describe('joining', () => {
  test('a moderator signs in without an invitation and becomes a root of the tree', async () => {
    const fx = makeApp({
      seed: false,
      env: GITHUB_ENV,
      github: fakeGitHub(profile('Founder', 9, 'The Founder')).client,
    })
    const { callback } = await signInWithGitHub(fx, { next: '/about' })
    expect(callback.status).toBe(303)
    expect(callback.headers.get('Location')).toBe('/about')
    const account = accountByLogin(fx.db, 'founder')
    expect(account?.isModerator).toBe(true)
    expect(account?.githubId).toBe(9)
    expect(getProfile(fx.db, 'Founder')?.invitedBy).toBeNull()
    expect(getProfile(fx.db, 'Founder')?.displayName).toBe('The Founder')
  })

  test('signing in without an invitation, not a moderator, is refused and creates nothing', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('stranger', 5)).client })
    const { callback } = await signInWithGitHub(fx)
    expect(callback.status).toBe(403)
    const html = await callback.text()
    expect(html).toContain('Membership is by invitation')
    expect(html).toContain('stranger')
    expect(accountByLogin(fx.db, 'stranger')).toBeNull()
    expect(sessionToken(callback)).toBeNull()
  })

  test('an invitation: made, redeemed once, with invited_by set', async () => {
    let next = profile('newcomer', 100)
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(() => next).client })
    const inviter = signIn(fx, 'quietfox')
    const made = await inviter.post('/settings/invites', { note: 'for the newcomer' })
    expect(made.status).toBe(200)
    const link = (await made.text()).match(/\/invite\/([A-Za-z0-9_-]{22})/)?.[1] ?? ''
    expect(link).toHaveLength(22)
    // Only the hash is stored.
    expect(JSON.stringify(fx.db.query('SELECT * FROM invites').all())).not.toContain(link)

    const page = await fx.get(`/invite/${link}`)
    expect(page.status).toBe(200)
    const pageHtml = await page.text()
    expect(pageHtml).toContain('quietfox invited you to heka news')
    expect(pageHtml).toContain(`/auth/github?invite=${link}`)
    expect(page.headers.get('Cache-Control')).toBe('no-store')

    const first = await signInWithGitHub(fx, { invite: link })
    expect(first.callback.status).toBe(303)
    expect(sessionToken(first.callback)).not.toBeNull()
    expect(getProfile(fx.db, 'newcomer')?.invitedBy?.login).toBe('quietfox')

    // Used: a second person with the same link is refused.
    next = profile('second', 101)
    const second = await signInWithGitHub(fx, { invite: link })
    expect(second.callback.status).toBe(403)
    expect(await second.callback.text()).toContain('That invitation no longer works')
    expect(accountByLogin(fx.db, 'second')).toBeNull()
    expect(await (await fx.get(`/invite/${link}`)).text()).toContain('already used')
  })

  test('an invitation expires after 14 days', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('late', 200)).client })
    const inviter = accountByLogin(fx.db, 'quietfox')
    createInvite(fx.db, {
      inviterId: inviter?.id ?? 0,
      codeHash: sha256Hex('A'.repeat(22)),
      note: '',
      now: fx.now(),
      ttl: RULES.inviteTtl,
    })
    fx.advance(RULES.inviteTtl + 1)
    expect(await (await fx.get(`/invite/${'A'.repeat(22)}`)).text()).toContain('expired')
    const { callback } = await signInWithGitHub(fx, { invite: 'A'.repeat(22) })
    expect(callback.status).toBe(403)
    expect(accountByLogin(fx.db, 'late')).toBeNull()
  })

  test('a withdrawn invitation stops working; only its maker can withdraw it', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('maybe', 300)).client })
    const inviter = signIn(fx, 'quietfox')
    const other = signIn(fx, 'oxbow')
    const html = await (await inviter.post('/settings/invites', {})).text()
    const code = html.match(/\/invite\/([A-Za-z0-9_-]{22})/)?.[1] ?? ''
    const id = fx.db
      .query<{ id: number }, [string]>('SELECT id FROM invites WHERE code_hash = ?')
      .get(sha256Hex(code))?.id
    expect((await other.post(`/invites/${id}/revoke`)).status).toBe(403)
    expect((await inviter.post(`/invites/${id}/revoke`)).status).toBe(303)
    expect(await (await fx.get(`/invite/${code}`)).text()).toContain('withdrew it')
    const { callback } = await signInWithGitHub(fx, { invite: code })
    expect(callback.status).toBe(403)
  })

  test('an unknown invitation code is a 404 that explains itself', async () => {
    const fx = makeApp()
    const res = await fx.get(`/invite/${'z'.repeat(22)}`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('There is no invitation at this address')
  })

  test('a returning member keeps their account; GitHub renames follow; moderator status mirrors MODERATORS', async () => {
    let current = profile('Founder', 9)
    const fx = makeApp({ seed: false, env: GITHUB_ENV, github: fakeGitHub(() => current).client })
    await signInWithGitHub(fx)
    current = profile('founder-renamed', 9)
    await signInWithGitHub(fx)
    const renamed = accountByLogin(fx.db, 'founder-renamed')
    expect(renamed).not.toBeNull()
    // Renamed out of MODERATORS: no longer a moderator.
    expect(renamed?.isModerator).toBe(false)
    expect(fx.db.query('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 })
  })

  test('a banned member cannot sign in', async () => {
    const fx = makeApp({
      seed: false,
      env: GITHUB_ENV,
      github: fakeGitHub(profile('gone', 50)).client,
    })
    createUser(fx.db, { login: 'gone', githubId: 50 })
    fx.db.query("UPDATE users SET banned = 1 WHERE login = 'gone'").run()
    const { callback } = await signInWithGitHub(fx)
    expect(callback.status).toBe(403)
    expect(await callback.text()).toContain('This account is banned')
  })
})

describe('sessions', () => {
  test('the cookie is HttpOnly, SameSite=Lax, 30 days, and Secure on https', async () => {
    const fx = makeApp({
      seed: false,
      env: GITHUB_ENV,
      github: fakeGitHub(profile('Founder', 1)).client,
    })
    const { callback } = await signInWithGitHub(fx)
    const cookie = callback.headers.getSetCookie().find((c) => c.startsWith('heka_session=')) ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${30 * 86400}`)
    expect(serializeCookie('heka_session', 'x', { maxAge: 1, secure: false })).not.toContain(
      'Secure',
    )
  })

  test('only a hash of the token is stored', async () => {
    const fx = makeApp({
      seed: false,
      env: GITHUB_ENV,
      github: fakeGitHub(profile('Founder', 1)).client,
    })
    const { callback } = await signInWithGitHub(fx)
    const token = sessionToken(callback) ?? ''
    const ids = fx.db
      .query<{ id: string }, []>('SELECT id FROM sessions')
      .all()
      .map((r) => r.id)
    expect(ids).toEqual([sha256Hex(token)])
  })

  test('signing in again rotates the session: the old one is deleted', async () => {
    const fx = makeApp({
      seed: false,
      env: GITHUB_ENV,
      github: fakeGitHub(profile('Founder', 1)).client,
    })
    const first = sessionToken((await signInWithGitHub(fx)).callback) ?? ''
    const second = sessionToken(
      (await signInWithGitHub(fx, { cookie: `heka_session=${first}` })).callback,
    )
    expect(second).not.toBe(first)
    const ids = fx.db
      .query<{ id: string }, []>('SELECT id FROM sessions')
      .all()
      .map((r) => r.id)
    expect(ids).toEqual([sha256Hex(second ?? '')])
  })

  test('expiry slides forward; an expired session is cleared', async () => {
    const fx = makeApp()
    const member = signIn(fx, 'quietfox')
    fx.advance(RULES.sessionTtl - 10)
    const res = await member.get('/')
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.startsWith('heka_session=') && c.includes(`Max-Age=${RULES.sessionTtl}`)),
    ).toBe(true)
    expect(await res.text()).toContain('href="/u/quietfox"')
    fx.advance(RULES.sessionTtl - 10)
    expect(await (await member.get('/')).text()).toContain('href="/u/quietfox"')
    fx.advance(RULES.sessionTtl + 1)
    const after = await member.get('/')
    expect(after.headers.getSetCookie().some((c) => c.includes('Max-Age=0'))).toBe(true)
    expect(await after.text()).toContain('Sign in')
  })

  test('signing out deletes the session row and clears the cookie', async () => {
    const fx = makeApp()
    const member = signIn(fx, 'quietfox')
    expect(countSessions(fx.db, member.id)).toBe(1)
    const res = await member.post('/signout')
    expect(res.status).toBe(303)
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.startsWith('heka_session=;') && c.includes('Max-Age=0')),
    ).toBe(true)
    expect(countSessions(fx.db, member.id)).toBe(0)
  })

  test('signed-in pages are private, no-store', async () => {
    const fx = makeApp()
    const member = signIn(fx, 'quietfox')
    for (const path of ['/', '/newest', '/u/quietfox', '/settings', '/replies', '/submit']) {
      const res = await member.get(path)
      expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
      expect(res.headers.get('Cache-Control')).not.toContain('public')
    }
  })
})

describe('CSRF', () => {
  test('a POST without the token, with a wrong one, or from another origin is refused', async () => {
    const fx = makeApp()
    const member = signIn(fx, 'quietfox')
    const item = fx.db
      .query<{ id: number }, []>(
        "SELECT id FROM items WHERE author_id <> (SELECT id FROM users WHERE login='quietfox') AND deleted = 0 LIMIT 1",
      )
      .get()
    const path = `/item/${item?.id}/vote`
    expect((await member.post(path, {}, { csrf: null })).status).toBe(403)
    expect((await member.post(path, {}, { csrf: 'nope' })).status).toBe(403)
    expect(
      (await member.post(path, {}, { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403)
    expect(
      (await member.post(path, {}, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    ).toBe(403)
    // Another member's token does not work either.
    const other = signIn(fx, 'oxbow')
    expect((await member.post(path, {}, { csrf: other.csrf })).status).toBe(403)
    expect(fx.db.query('SELECT count(*) AS n FROM item_votes').get()).toEqual({ n: 0 })
    // The real token in the header (fetch) works.
    const ok = await member.post(
      path,
      {},
      { csrf: null, headers: { 'x-csrf-token': member.csrf, accept: 'application/json' } },
    )
    expect(ok.status).toBe(200)
  })

  test('the origin check needs Origin or Sec-Fetch-Site, and they must match', () => {
    const h = (init: Record<string, string>) => new Headers(init)
    expect(sameOrigin(h({}), ORIGIN)).toBe(false)
    expect(sameOrigin(h({ origin: ORIGIN }), ORIGIN)).toBe(true)
    expect(sameOrigin(h({ 'sec-fetch-site': 'same-origin' }), ORIGIN)).toBe(true)
    expect(sameOrigin(h({ 'sec-fetch-site': 'same-site', origin: ORIGIN }), ORIGIN)).toBe(false)
    expect(sameOrigin(h({ origin: 'http://news.example.test' }), ORIGIN)).toBe(false)
    expect(csrfToken(SECRET, 'a')).not.toBe(csrfToken(SECRET, 'b'))
  })

  test('signed-out POSTs are sent to sign in, not executed', async () => {
    const fx = makeApp()
    const res = await fx.app.request('/submit', {
      method: 'POST',
      body: new URLSearchParams({ title: 'x' }),
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toStartWith('/signin?next=')
  })
})

describe('development sign-in', () => {
  test('is impossible in production', async () => {
    const config = loadConfig({ NODE_ENV: 'production' })
    expect(config.devSignIn).toBe(false)
    const fx = makeApp()
    const res = await fx.get('/dev/sign-in-as/ledgerline')
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie().some((c) => c.startsWith('heka_session='))).toBe(false)
    expect(fx.db.query('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  test('is off once GitHub is configured, even outside production', async () => {
    expect(loadConfig({ GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' }).devSignIn).toBe(false)
    const fx = makeApp({
      env: { NODE_ENV: 'development', ...GITHUB_ENV },
      github: fakeGitHub(profile('x', 1)).client,
    })
    expect((await fx.get('/dev/sign-in-as/ledgerline')).status).toBe(404)
  })

  test('works in development without GitHub, for seeded members', async () => {
    const fx = makeApp({ env: { NODE_ENV: 'development', SESSION_SECRET: '' } })
    const signin = await (await fx.get('/signin')).text()
    expect(signin).toContain('/dev/sign-in-as/ledgerline')
    const res = await fx.get('/dev/sign-in-as/ledgerline?next=/submit')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/submit')
    expect(sessionToken(res)).not.toBeNull()
    expect((await fx.get('/dev/sign-in-as/nobody')).status).toBe(404)
  })
})

describe('sign-in availability', () => {
  test('production without GitHub says sign-in opens soon, and does not crash', async () => {
    const fx = makeApp()
    expect(await (await fx.get('/signin')).text()).toContain('sign-in opens soon')
    expect((await fx.get('/auth/github')).status).toBe(303)
  })

  test('production needs SESSION_SECRET as well as the GitHub app', () => {
    expect(
      loadConfig({ NODE_ENV: 'production', GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' })
        .github,
    ).toBeNull()
    expect(
      loadConfig({
        NODE_ENV: 'production',
        GITHUB_CLIENT_ID: 'a',
        GITHUB_CLIENT_SECRET: 'b',
        SESSION_SECRET: 's',
      }).github,
    ).not.toBeNull()
  })

  test('with GitHub configured, /signin offers it', async () => {
    const fx = makeApp({ env: GITHUB_ENV, github: fakeGitHub(profile('x', 1)).client })
    expect(await (await fx.get('/signin?next=/posts')).text()).toContain(
      'href="/auth/github?next=%2Fposts"',
    )
  })
})
