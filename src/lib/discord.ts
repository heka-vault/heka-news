// Linking a Discord account (ADR 0009): Discord's OAuth web flow with the `identify` scope only,
// the code exchanged server-side. The access token is used once to read the user and then revoked
// and dropped; it is never stored. Linking never signs anyone in.
//
// State works as it does for GitHub (src/lib/oauth.ts): a signed, short-lived token carrying a
// nonce that is also set in a cookie, so a callback only completes in the browser that started
// it. The state also carries the member who started, and the callback must come from the same
// member, so nobody can attach their Discord account to someone else's session.

import { hmac, randomToken, safeEqual } from './crypto.ts'

export const DISCORD_OAUTH_COOKIE = 'heka_discord_oauth'

export interface DiscordState {
  nonce: string
  /** The member linking. */
  userId: number
  /** Unix seconds after which the state is refused. */
  exp: number
}

export function newDiscordNonce(): string {
  return randomToken(16)
}

export function signDiscordState(secret: string, state: DiscordState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${hmac(secret, 'discord-state', body)}`
}

/** The state if its signature holds and it has not expired; otherwise null. */
export function verifyDiscordState(
  secret: string,
  token: string,
  now: number,
): DiscordState | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  if (!safeEqual(token.slice(dot + 1), hmac(secret, 'discord-state', body))) return null
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DiscordState
    if (typeof state.nonce !== 'string' || typeof state.userId !== 'number') return null
    if (typeof state.exp !== 'number' || state.exp < now) return null
    return state
  } catch {
    return null
  }
}

export interface DiscordUser {
  /** A snowflake, kept as text. */
  id: string
  username: string
}

/** The calls the link route makes to Discord. Tests pass a fake. */
export interface DiscordOAuthClient {
  authorizeUrl(opts: { redirectUri: string; state: string }): string
  /** Trade the code for an access token; throws when Discord refuses. */
  exchange(opts: { code: string; redirectUri: string }): Promise<string>
  user(token: string): Promise<DiscordUser>
  /** Best effort: revoke the token once the user is read. */
  revoke(token: string): Promise<void>
}

const API = 'https://discord.com/api/v10'

export function discordOAuthClient(
  creds: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): DiscordOAuthClient {
  const basic = () =>
    `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`
  return {
    authorizeUrl({ redirectUri, state }) {
      const url = new URL('https://discord.com/oauth2/authorize')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', creds.clientId)
      url.searchParams.set('scope', 'identify')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchange({ code, redirectUri }) {
      const res = await fetchImpl(`${API}/oauth2/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: basic(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string
        error?: string
      }
      if (!res.ok || !data.access_token) {
        throw new Error(`Discord refused the code: ${data.error ?? res.status}`)
      }
      return data.access_token
    },

    async user(token) {
      const res = await fetchImpl(`${API}/users/@me`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Discord /users/@me answered ${res.status}`)
      const data = (await res.json()) as { id?: unknown; username?: unknown }
      if (typeof data.id !== 'string' || !/^\d{1,32}$/.test(data.id)) {
        throw new Error('Discord /users/@me returned no id')
      }
      if (typeof data.username !== 'string' || data.username === '') {
        throw new Error('Discord /users/@me returned no username')
      }
      return { id: data.id, username: data.username.slice(0, 64) }
    },

    async revoke(token) {
      await fetchImpl(`${API}/oauth2/token/revoke`, {
        method: 'POST',
        headers: {
          Authorization: basic(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
    },
  }
}
