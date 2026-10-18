// What every route module shares: the app's dependencies, the page context, and the guards for
// state-changing requests (same origin, signed in, CSRF token, rate limit). Route modules
// register on the app in src/app.tsx; none of them sees SQL (src/db/ does).

import type { Context, Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { type Config, RATE_LIMITS, type RateAction } from '../config.ts'
import type { Db } from '../db/index.ts'
import { takeRate } from '../db/ratelimit.ts'
import type { Assets } from '../lib/assets.ts'
import { CACHE_NONE } from '../lib/http.ts'
import type { GitHubClient } from '../lib/oauth.ts'
import { csrfTokenValid, sameOrigin } from '../lib/session.ts'
import type { Fields } from '../lib/validate.ts'
import type { PageContext, SigninMode, Viewer } from '../views/context.ts'

export type AppEnv = {
  Variables: {
    viewer: Viewer | null
    /** The SHA-256 id of the request's live session, if any. */
    sessionId: string | null
  }
}

export type App = Hono<AppEnv>
export type C = Context<AppEnv>

export type HtmlStatus = 200 | 400 | 403 | 404 | 409 | 410 | 422 | 429

export interface Web {
  db: Db
  config: Config
  assets: Assets
  clock: () => number
  github: GitHubClient | null
  signin: SigninMode
  ctxOf: (c: C) => PageContext
  html: (c: C, node: Child, status?: HtmlStatus) => Response
  notFound: (c: C) => Response
  /** A page explaining a refusal: 403 by default. */
  refuse: (c: C, message: { title: string; body: Child }, status?: HtmlStatus) => Response
}

/** fetch() from src/client/ asks for JSON; plain forms get pages and redirects. */
export function wantsJson(c: C): boolean {
  return (c.req.header('accept') ?? '').includes('application/json')
}

/** A form's fields, strings only (files are ignored), repeated names as lists. */
export async function readFields(c: C): Promise<Fields> {
  const body = await c.req.parseBody({ all: true }).catch(() => ({}))
  const out: Fields = {}
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value))
      out[key] = value.filter((v): v is string => typeof v === 'string')
  }
  return out
}

/** /signin with a way back, as a 303 so a POST becomes a GET. */
export function signinRedirect(c: C, next: string) {
  return c.redirect(`/signin?next=${encodeURIComponent(next)}`, 303)
}

export type Guarded = { viewer: Viewer; fields: Fields } | Response

/**
 * The guard on every state-changing request: it must come from this site (Origin and
 * Sec-Fetch-Site), from a signed-in member, and carry the session's CSRF token in the form or in
 * X-CSRF-Token. Returns the member and the form, or the response to send instead.
 */
export async function guardPost(web: Web, c: C, back: string): Promise<Guarded> {
  c.header('Cache-Control', CACHE_NONE)
  if (!sameOrigin(c.req.raw.headers, web.config.publicUrl)) return csrfRefusal(web, c)
  const viewer = c.get('viewer')
  const sessionId = c.get('sessionId')
  if (!viewer || !sessionId) {
    if (wantsJson(c)) return c.json({ error: 'Sign in first. Your session may have ended.' }, 401)
    return signinRedirect(c, back)
  }
  const fields = await readFields(c)
  const token = c.req.header('x-csrf-token') ?? fields.csrf
  if (!csrfTokenValid(web.config.sessionSecret, sessionId, token)) return csrfRefusal(web, c)
  return { viewer, fields }
}

function csrfRefusal(web: Web, c: C) {
  if (wantsJson(c))
    return c.json({ error: 'This page is out of date. Reload it and try again.' }, 403)
  return web.refuse(c, {
    title: 'This form is out of date',
    body: 'It was opened before you last signed in, or it came from another site. Go back, reload the page and send it again.',
  })
}

const RATE_WORDS: Record<RateAction, string> = {
  item: 'items',
  comment: 'comments',
  vote: 'votes',
  flag: 'flags',
  preview: 'previews',
}

/**
 * Count one `action` against the member's hourly limit. Returns null when it is allowed, or the
 * friendly 429 to send when they are over.
 */
export function rateLimited(web: Web, c: C, viewer: Viewer, action: RateAction) {
  const limit = RATE_LIMITS[action]
  if (takeRate(web.db, viewer.id, action, limit, web.clock())) return null
  c.header('Retry-After', '3600')
  const message = `That is ${limit} ${RATE_WORDS[action]} in the last hour, the most we take from one member. Try again in a little while.`
  if (wantsJson(c)) return c.json({ error: message }, 429)
  return web.refuse(c, { title: 'Slow down a little', body: message }, 429)
}

/** A positive integer route parameter, or null. */
export function idParam(c: C, name = 'id'): number | null {
  const raw = c.req.param(name) ?? ''
  return /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null
}

/** A same-site path to return to, or "/". */
export function safeNext(next: string | undefined | null): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  return next
}
