// HTTP caching and transport (ADR 0003 for the session switch):
//
// - An anonymous GET of a page may be cached by a shared cache for a minute and served stale for
//   five while it revalidates. Browsers always revalidate (max-age=0), cheaply, with the ETag.
// - A request that carries the session cookie gets `private, no-store`, whatever the page.
// - Fingerprinted assets are immutable for a year.
// - Text responses get a weak ETag (304 when it matches) and brotli or gzip.

import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { SESSION_COOKIE } from '../config.ts'

export const CACHE_ANONYMOUS = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
export const CACHE_PRIVATE = 'private, no-store'
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_STATIC = 'public, max-age=86400'
export const CACHE_NONE = 'no-store'

/** True when the Cookie header carries the session cookie, whatever its value. */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((part) => part.trim().split('=')[0] === SESSION_COOKIE)
}

/** Cache-Control for a page or feed response to this request. */
export function pageCacheControl(cookieHeader: string | null | undefined): string {
  return hasSessionCookie(cookieHeader) ? CACHE_PRIVATE : CACHE_ANONYMOUS
}

/** A weak validator: the response body's hash. */
export function weakEtag(body: Uint8Array): string {
  return `W/"${Bun.hash(body).toString(36)}"`
}

/** True when If-None-Match lists this ETag (weak comparison) or is "*". */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const bare = etag.replace(/^W\//, '')
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || tag.replace(/^W\//, '') === bare)
}

export type Encoding = 'br' | 'gzip'

/** The best encoding the client accepts, or null. */
export function negotiateEncoding(acceptEncoding: string | null | undefined): Encoding | null {
  if (!acceptEncoding) return null
  const accepted = new Map<string, number>()
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (!name) continue
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    accepted.set(name, q ? Number(q.slice(2)) : 1)
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0
  if (ok('br')) return 'br'
  if (ok('gzip')) return 'gzip'
  return null
}

export function compressBody(body: Uint8Array, encoding: Encoding): Uint8Array<ArrayBuffer> {
  const out =
    encoding === 'br'
      ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
      : gzipSync(body, { level: 6 })
  return new Uint8Array(out)
}

const COMPRESSIBLE = /^(text\/|application\/(xml|rss\+xml|atom\+xml|json|ld\+json)|image\/svg)/

export function isCompressible(contentType: string | null): boolean {
  return contentType !== null && COMPRESSIBLE.test(contentType)
}

/** Headers on every response. The site loads nothing from elsewhere and runs no script. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * Finish a response: security headers, Cache-Control (if the route did not set one), the ETag and
 * 304, and compression. Pure function of the request and the route's response.
 */
export async function finishResponse(req: Request, res: Response): Promise<Response> {
  const headers = new Headers(res.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value)
  }

  const isRead = req.method === 'GET' || req.method === 'HEAD'
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', isRead ? pageCacheControl(req.headers.get('cookie')) : CACHE_NONE)
    headers.append('Vary', 'Cookie')
  }

  const type = headers.get('Content-Type')
  if (!isRead || headers.has('Content-Encoding') || !isCompressible(type) || !res.body) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }

  const body = new Uint8Array(await res.arrayBuffer())
  if (res.status === 200) {
    const etag = weakEtag(body)
    headers.set('ETag', etag)
    if (etagMatches(req.headers.get('if-none-match'), etag)) {
      headers.delete('Content-Type')
      headers.delete('Content-Length')
      return new Response(null, { status: 304, headers })
    }
  }

  headers.append('Vary', 'Accept-Encoding')
  const encoding =
    body.byteLength > 1024 ? negotiateEncoding(req.headers.get('accept-encoding')) : null
  headers.delete('Content-Length')
  if (!encoding) return new Response(body, { status: res.status, headers })
  headers.set('Content-Encoding', encoding)
  return new Response(compressBody(body, encoding), { status: res.status, headers })
}
