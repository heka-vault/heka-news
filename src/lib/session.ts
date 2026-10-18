// Cookies and CSRF (ADR 0007). The session cookie carries a random token; the database keeps only
// its SHA-256 (src/db/sessions.ts). The CSRF token is an HMAC of the session id, so it needs no
// storage, changes whenever the session does, and dies with it.

import { RULES, SESSION_COOKIE } from '../config.ts'
import { hmac, safeEqual, sha256Hex } from './crypto.ts'

/** The value of one cookie in a Cookie header, or null. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export interface CookieOptions {
  maxAge: number
  secure: boolean
  path?: string
}

/** A Set-Cookie value: HttpOnly and SameSite=Lax always, Secure when the site is https. */
export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

export function sessionCookie(token: string, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: RULES.sessionTtl, secure })
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure })
}

/** The database id of a session token. */
export function sessionId(token: string): string {
  return sha256Hex(token)
}

/** The CSRF token for a session: put in every form and in fetch requests' X-CSRF-Token. */
export function csrfToken(secret: string, sessionIdHash: string): string {
  return hmac(secret, 'csrf', sessionIdHash)
}

export function csrfTokenValid(secret: string, sessionIdHash: string, given: unknown): boolean {
  return typeof given === 'string' && safeEqual(given, csrfToken(secret, sessionIdHash))
}

/**
 * True when a state-changing request comes from this site: Sec-Fetch-Site, when the browser sends
 * it, must be same-origin; Origin, when present, must be PUBLIC_URL's origin; and at least one of
 * them must be there. Every browser that matters sends Origin on a POST.
 */
export function sameOrigin(headers: Headers, publicUrl: string): boolean {
  const site = headers.get('sec-fetch-site')
  const origin = headers.get('origin')
  if (site === null && origin === null) return false
  if (site !== null && site !== 'same-origin') return false
  if (origin !== null && origin !== new URL(publicUrl).origin) return false
  return true
}
