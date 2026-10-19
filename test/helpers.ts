// Shared fixtures: an in-memory database (optionally seeded) and the app around it, with a fixed
// (and movable) clock so relative times, ranking, edit windows and expiries are deterministic.

import { seedDatabase } from '../scripts/seed-data.ts'
import { createApp } from '../src/app.tsx'
import { loadConfig, RULES } from '../src/config.ts'
import { type Db, openDb } from '../src/db/index.ts'
import { createSession } from '../src/db/sessions.ts'
import { accountByLogin } from '../src/db/users.ts'
import { buildAssets } from '../src/lib/assets.ts'
import { randomToken } from '../src/lib/crypto.ts'
import type { GitHubClient, GitHubProfile } from '../src/lib/oauth.ts'
import { csrfToken, sessionId } from '../src/lib/session.ts'
import type { Fetch } from '../src/lib/talk.ts'

export const NOW = 1_792_000_000 // 2026-10-15
export const ORIGIN = 'https://news.example.test'
export const SHA = 'abc123def'
export const SECRET = 'test-session-secret'

const assets = buildAssets()

export interface AppFixture {
  db: Db
  app: ReturnType<typeof createApp>
  get: (path: string, headers?: Record<string, string>) => Response | Promise<Response>
  /** Move the clock. */
  advance: (seconds: number) => void
  now: () => number
}

/**
 * The app on an in-memory database. By default it looks like production with sign-in closed
 * (NODE_ENV=production, no GitHub); pass env and a fake GitHub client to open it.
 */
export function makeApp(
  opts: {
    seed?: boolean
    env?: Record<string, string>
    github?: GitHubClient | null
    fetch?: Fetch
  } = {},
): AppFixture {
  const db: Db = openDb(':memory:')
  if (opts.seed !== false) seedDatabase(db, NOW)
  const config = loadConfig({
    PUBLIC_URL: ORIGIN,
    GIT_SHA: SHA,
    NODE_ENV: 'production',
    SESSION_SECRET: SECRET,
    ...opts.env,
  })
  let now = NOW
  const app = createApp({
    db,
    config,
    assets,
    clock: () => now,
    github: opts.github ?? null,
    // Nothing in a test reaches the network: an unexpected request fails loudly.
    fetch: opts.fetch ?? (async (input) => Promise.reject(new Error(`unexpected fetch ${input}`))),
  })
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
  return {
    db,
    app,
    get,
    advance: (seconds) => {
      now += seconds
    },
    now: () => now,
  }
}

export interface Member {
  id: number
  login: string
  cookie: string
  csrf: string
  /** GET as this member. */
  get: (path: string, headers?: Record<string, string>) => Response | Promise<Response>
  /** POST a form as this member, from the site's origin, with the CSRF token unless overridden. */
  post: (
    path: string,
    fields?: Record<string, string | string[]>,
    opts?: { headers?: Record<string, string>; csrf?: string | null },
  ) => Response | Promise<Response>
}

/** A signed-in member: a session straight in the database, as the sign-in route would make. */
export function signIn(fx: AppFixture, login: string): Member {
  const account = accountByLogin(fx.db, login)
  if (!account) throw new Error(`no member ${login}`)
  const token = randomToken(32)
  const id = sessionId(token)
  createSession(fx.db, id, account.id, fx.now(), RULES.sessionTtl)
  const cookie = `heka_session=${token}`
  const csrf = csrfToken(SECRET, id)
  return {
    id: account.id,
    login: account.login,
    cookie,
    csrf,
    get: (path, headers = {}) => fx.app.request(path, { headers: { cookie, ...headers } }),
    post: (path, fields = {}, opts = {}) => {
      const body = new URLSearchParams()
      if (opts.csrf !== null) body.set('csrf', opts.csrf ?? csrf)
      for (const [key, value] of Object.entries(fields)) {
        for (const v of Array.isArray(value) ? value : [value]) body.append(key, v)
      }
      return fx.app.request(path, {
        method: 'POST',
        body,
        headers: {
          cookie,
          origin: ORIGIN,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/x-www-form-urlencoded',
          ...opts.headers,
        },
      })
    },
  }
}

/** A GitHub that answers with this profile, and records what it was asked. */
export function fakeGitHub(profile: GitHubProfile | (() => GitHubProfile)) {
  const calls = { exchanges: [] as { code: string; verifier: string }[], revoked: [] as string[] }
  const client: GitHubClient = {
    authorizeUrl: ({ redirectUri, state, challenge }) =>
      `https://github.test/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${challenge}`,
    exchange: async ({ code, verifier }) => {
      calls.exchanges.push({ code, verifier })
      if (code === 'bad') throw new Error('bad_verification_code')
      return `token-for-${code}`
    },
    profile: async () => (typeof profile === 'function' ? profile() : profile),
    revoke: async (token) => {
      calls.revoked.push(token)
    },
  }
  return { client, calls }
}

/** Every JSON-LD block in a page, parsed. */
export function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (m) => JSON.parse(m[1] ?? 'null') as Record<string, unknown>,
  )
}
