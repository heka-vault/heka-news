// Signing in and out (ADR 0003, 0007): /signin, the GitHub OAuth flow, /invite/:code, /signout,
// and the development-only /dev/sign-in-as/:login.

import { isFoundingModerator, RULES, SESSION_COOKIE } from '../config.ts'
import {
  createModerator,
  type GitHubIdentity,
  redeemInvite,
  refreshAccount,
} from '../db/accounts.ts'
import { inviteByHash } from '../db/invites.ts'
import { createSession, deleteSession } from '../db/sessions.ts'
import { accountByGithubId, accountByLogin, listDevAccounts } from '../db/users.ts'
import { randomToken, sha256Hex } from '../lib/crypto.ts'
import { CACHE_NONE } from '../lib/http.ts'
import {
  newNonce,
  OAUTH_COOKIE,
  pkceChallenge,
  pkceVerifier,
  signState,
  verifyState,
} from '../lib/oauth.ts'
import {
  clearSessionCookie,
  csrfTokenValid,
  readCookie,
  sameOrigin,
  serializeCookie,
  sessionCookie,
  sessionId,
} from '../lib/session.ts'
import { InvitePage, SigninPage, SigninRefusedPage } from '../views/pages/AccountPages.tsx'
import { type App, type C, readFields, safeNext, type Web } from './web.ts'

/** Invitation codes are 128 random bits as base64url: 22 characters. */
const INVITE_CODE = /^[A-Za-z0-9_-]{22}$/

export function registerAuth(app: App, web: Web): void {
  const { db, config, clock } = web
  const redirectUri = `${config.publicUrl}/auth/github/callback`

  /** Start a session for a member: any session this browser already had is ended (rotation). */
  const signIn = (c: C, userId: number, next: string) => {
    const old = readCookie(c.req.header('cookie'), SESSION_COOKIE)
    if (old) deleteSession(db, sessionId(old))
    const token = randomToken(32)
    createSession(db, sessionId(token), userId, clock(), RULES.sessionTtl)
    c.header('Cache-Control', CACHE_NONE)
    c.header('Set-Cookie', sessionCookie(token, config.secureCookies), { append: true })
    return c.redirect(safeNext(next), 303)
  }

  const refused = (
    c: C,
    reason: Parameters<typeof SigninRefusedPage>[0]['reason'],
    login?: string,
    status: 403 | 400 = 403,
  ) => {
    c.header('Cache-Control', CACHE_NONE)
    c.header('Set-Cookie', clearOAuth(), { append: true })
    return web.html(
      c,
      <SigninRefusedPage ctx={web.ctxOf(c)} reason={reason} login={login} />,
      status,
    )
  }

  const clearOAuth = () =>
    serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: config.secureCookies, path: '/auth' })

  app.get('/signin', (c) => {
    const next = safeNext(c.req.query('next'))
    if (c.get('viewer')) return c.redirect(next, 303)
    const devAccounts = web.signin === 'dev' ? listDevAccounts(db) : undefined
    return web.html(c, <SigninPage ctx={web.ctxOf(c)} next={next} devAccounts={devAccounts} />)
  })

  app.get('/invite/:code', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const code = c.req.param('code')
    const invite = INVITE_CODE.test(code) ? inviteByHash(db, sha256Hex(code), clock()) : null
    return web.html(
      c,
      <InvitePage ctx={web.ctxOf(c)} code={code} invite={invite} />,
      invite ? 200 : 404,
    )
  })

  // Step 1: to GitHub, with a signed state, a nonce cookie and a PKCE challenge.
  app.get('/auth/github', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    if (!web.github) return c.redirect('/signin', 303)
    const invite = c.req.query('invite')
    const nonce = newNonce()
    const state = signState(config.sessionSecret, {
      nonce,
      next: safeNext(c.req.query('next')),
      invite: invite && INVITE_CODE.test(invite) ? invite : null,
      exp: clock() + RULES.oauthStateTtl,
    })
    c.header(
      'Set-Cookie',
      serializeCookie(OAUTH_COOKIE, nonce, {
        maxAge: RULES.oauthStateTtl,
        secure: config.secureCookies,
        path: '/auth',
      }),
      { append: true },
    )
    const challenge = pkceChallenge(pkceVerifier(config.sessionSecret, nonce))
    return c.redirect(web.github.authorizeUrl({ redirectUri, state, challenge }), 302)
  })

  // Step 2: back from GitHub. Check the state, trade the code, read the profile, drop the token.
  app.get('/auth/github/callback', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const github = web.github
    if (!github) return c.redirect('/signin', 303)
    if (c.req.query('error') === 'access_denied') return refused(c, 'cancelled', undefined, 400)

    const now = clock()
    const state = verifyState(config.sessionSecret, c.req.query('state') ?? '', now)
    const nonce = readCookie(c.req.header('cookie'), OAUTH_COOKIE)
    const code = c.req.query('code')
    if (!state || !nonce || nonce !== state.nonce || !code) {
      return refused(c, 'failed', undefined, 400)
    }

    let identity: GitHubIdentity
    try {
      const token = await github.exchange({
        code,
        verifier: pkceVerifier(config.sessionSecret, state.nonce),
        redirectUri,
      })
      try {
        const profile = await github.profile(token)
        identity = {
          githubId: profile.id,
          login: profile.login,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        }
      } finally {
        // Never kept: revoked as soon as the profile is read (best effort, not awaited).
        void github.revoke(token)
      }
    } catch (error) {
      console.error('GitHub sign-in failed:', error instanceof Error ? error.message : error)
      return refused(c, 'failed', undefined, 400)
    }

    c.header('Set-Cookie', clearOAuth(), { append: true })
    // Founding moderators (MODERATORS) are made moderators here; nobody is demoted at sign-in.
    const founding = isFoundingModerator(config, identity.login)
    const existing = accountByGithubId(db, identity.githubId)
    if (existing) {
      if (existing.banned) return refused(c, 'banned', existing.login)
      if (!refreshAccount(db, existing.id, identity, founding)) {
        return refused(c, 'login-taken', identity.login)
      }
      return signIn(c, existing.id, state.next)
    }

    // A new member: a founding moderator starts a branch of the tree; others need an invitation.
    if (founding) {
      const created = createModerator(db, identity, now)
      if (!created.ok) return refused(c, 'login-taken', identity.login)
      return signIn(c, created.userId, state.next)
    }
    if (!state.invite) return refused(c, 'not-invited', identity.login)
    const created = redeemInvite(db, sha256Hex(state.invite), identity, false, now)
    if (!created.ok) {
      return refused(c, created.reason === 'invite' ? 'invite' : 'login-taken', identity.login)
    }
    return signIn(c, created.userId, '/settings?welcome=1')
  })

  app.post('/signout', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    if (!sameOrigin(c.req.raw.headers, config.publicUrl)) {
      return web.refuse(c, {
        title: 'This form is out of date',
        body: 'Reload the page and try again.',
      })
    }
    const id = c.get('sessionId')
    if (id) {
      const fields = await readFields(c)
      if (!csrfTokenValid(config.sessionSecret, id, fields.csrf)) {
        return web.refuse(c, {
          title: 'This form is out of date',
          body: 'Reload the page and try again.',
        })
      }
      deleteSession(db, id)
    }
    c.header('Set-Cookie', clearSessionCookie(config.secureCookies), { append: true })
    return c.redirect('/', 303)
  })

  // Development only: sign in as a seeded member. Not registered in production or once GitHub is
  // configured, and the handler checks again (test/auth.test.ts).
  if (config.devSignIn && !config.production) {
    app.get('/dev/sign-in-as/:login', (c) => {
      if (config.production || !config.devSignIn) return web.notFound(c)
      const account = accountByLogin(db, c.req.param('login'))
      if (!account || account.banned) return web.notFound(c)
      return signIn(c, account.id, c.req.query('next') ?? '/')
    })
  }
}
