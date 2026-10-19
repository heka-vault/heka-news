// Linking a Discord account from /settings (ADR 0009): /auth/discord, its callback, and unlinking.
// Linking is never a way to sign in: every step needs a member who is already signed in.

import { RULES } from '../config.ts'
import { linkDiscord, unlinkDiscord } from '../db/discord.ts'
import {
  DISCORD_OAUTH_COOKIE,
  type DiscordUser,
  newDiscordNonce,
  signDiscordState,
  verifyDiscordState,
} from '../lib/discord.ts'
import { CACHE_NONE } from '../lib/http.ts'
import { readCookie, serializeCookie } from '../lib/session.ts'
import { type App, guardPost, signinRedirect, type Web } from './web.ts'

const BACK = '/settings#discord-heading'

export function registerDiscord(app: App, web: Web): void {
  const { db, config, clock } = web
  const redirectUri = `${config.publicUrl}/auth/discord/callback`

  const clearCookie = () =>
    serializeCookie(DISCORD_OAUTH_COOKIE, '', {
      maxAge: 0,
      secure: config.secureCookies,
      path: '/auth/discord',
    })

  // Step 1: to Discord, with a signed state naming the member and a nonce cookie.
  app.get('/auth/discord', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const viewer = c.get('viewer')
    if (!viewer) return signinRedirect(c, '/settings')
    if (!web.discord) return c.redirect(BACK, 303)
    const nonce = newDiscordNonce()
    const state = signDiscordState(config.sessionSecret, {
      nonce,
      userId: viewer.id,
      exp: clock() + RULES.oauthStateTtl,
    })
    c.header(
      'Set-Cookie',
      serializeCookie(DISCORD_OAUTH_COOKIE, nonce, {
        maxAge: RULES.oauthStateTtl,
        secure: config.secureCookies,
        path: '/auth/discord',
      }),
      { append: true },
    )
    return c.redirect(web.discord.authorizeUrl({ redirectUri, state }), 302)
  })

  // Step 2: back from Discord. Same browser, same member; read the user, drop the token, link.
  app.get('/auth/discord/callback', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const viewer = c.get('viewer')
    if (!viewer) return signinRedirect(c, '/settings')
    const discord = web.discord
    if (!discord) return c.redirect(BACK, 303)
    c.header('Set-Cookie', clearCookie(), { append: true })
    if (c.req.query('error') === 'access_denied') {
      return c.redirect('/settings?discord=cancelled#discord-heading', 303)
    }

    const failed = () =>
      web.refuse(
        c,
        {
          title: 'Discord did not connect',
          body: 'The link from Discord was incomplete or out of date. Go back to your settings and try again.',
        },
        400,
      )
    const state = verifyDiscordState(config.sessionSecret, c.req.query('state') ?? '', clock())
    const nonce = readCookie(c.req.header('cookie'), DISCORD_OAUTH_COOKIE)
    const code = c.req.query('code')
    if (!state || !nonce || nonce !== state.nonce || state.userId !== viewer.id || !code) {
      return failed()
    }

    let user: DiscordUser
    try {
      const token = await discord.exchange({ code, redirectUri })
      try {
        user = await discord.user(token)
      } finally {
        // Never kept: revoked as soon as the user is read (best effort, not awaited).
        void discord.revoke(token)
      }
    } catch (error) {
      console.error('Discord linking failed:', error instanceof Error ? error.message : error)
      return failed()
    }

    const linked = linkDiscord(
      db,
      viewer.id,
      { discordId: user.id, username: user.username },
      clock(),
    )
    if (!linked.ok) {
      return web.refuse(
        c,
        {
          title: 'That Discord account is taken',
          body: 'It is already connected to another member here. They can disconnect it from their settings.',
        },
        409,
      )
    }
    return c.redirect('/settings?discord=linked#discord-heading', 303)
  })

  app.post('/settings/discord/unlink', async (c) => {
    const guard = await guardPost(web, c, '/settings')
    if (guard instanceof Response) return guard
    unlinkDiscord(db, guard.viewer.id)
    return c.redirect('/settings?discord=unlinked#discord-heading', 303)
  })
}
