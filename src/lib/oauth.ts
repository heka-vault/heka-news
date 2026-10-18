// GitHub sign-in (ADR 0003, 0007): the OAuth app web flow with PKCE, no scopes beyond the public
// profile, the code exchanged server-side. The access token is used once to read the profile and
// then revoked and dropped; it is never stored.
//
// State is stateless: a signed, short-lived token carrying a nonce, the return path and an
// optional invitation code. The nonce is also set in a short-lived cookie, so a callback only
// completes in the browser that started it (no login CSRF). The PKCE verifier is derived from the
// nonce with the server secret, so it never needs storing and cannot be computed from the state.

import { hmac, randomToken, safeEqual, sha256Base64Url } from './crypto.ts'

export const OAUTH_COOKIE = 'heka_oauth'

export interface OAuthState {
  nonce: string
  /** Same-site path to land on after signing in. */
  next: string
  /** Invitation code, when the flow started from /invite/:code. */
  invite: string | null
  /** Unix seconds after which the state is refused. */
  exp: number
}

export function newNonce(): string {
  return randomToken(16)
}

export function signState(secret: string, state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${hmac(secret, 'oauth-state', body)}`
}

/** The state if its signature holds and it has not expired; otherwise null. */
export function verifyState(secret: string, token: string, now: number): OAuthState | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!safeEqual(signature, hmac(secret, 'oauth-state', body))) return null
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState
    if (typeof state.nonce !== 'string' || typeof state.next !== 'string') return null
    if (typeof state.exp !== 'number' || state.exp < now) return null
    if (state.invite !== null && typeof state.invite !== 'string') return null
    return state
  } catch {
    return null
  }
}

/** The PKCE code verifier for a flow: 43 characters, derivable only with the secret. */
export function pkceVerifier(secret: string, nonce: string): string {
  return hmac(secret, 'pkce', nonce)
}

export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier)
}

export interface GitHubProfile {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

/** The calls the sign-in route makes to GitHub. Tests pass a fake. */
export interface GitHubClient {
  authorizeUrl(opts: { redirectUri: string; state: string; challenge: string }): string
  /** Trade the code for an access token; throws when GitHub refuses. */
  exchange(opts: { code: string; verifier: string; redirectUri: string }): Promise<string>
  profile(token: string): Promise<GitHubProfile>
  /** Best effort: revoke the token once the profile is read. */
  revoke(token: string): Promise<void>
}

const USER_AGENT = 'heka-news'

export function githubClient(
  creds: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): GitHubClient {
  return {
    authorizeUrl({ redirectUri, state, challenge }) {
      const url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', creds.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('allow_signup', 'true')
      return url.toString()
    },

    async exchange({ code, verifier, redirectUri }) {
      const res = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string
        error?: string
      }
      if (!res.ok || !data.access_token) {
        throw new Error(`GitHub refused the code: ${data.error ?? res.status}`)
      }
      return data.access_token
    },

    async profile(token) {
      const res = await fetchImpl('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`)
      const data = (await res.json()) as {
        id?: unknown
        login?: unknown
        name?: unknown
        avatar_url?: unknown
      }
      if (typeof data.id !== 'number' || typeof data.login !== 'string') {
        throw new Error('GitHub /user returned no id or login')
      }
      return {
        id: data.id,
        login: data.login,
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null,
        avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
      }
    },

    async revoke(token) {
      const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
      await fetchImpl(`https://api.github.com/applications/${creds.clientId}/token`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Basic ${basic}`,
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: token }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
    },
  }
}
