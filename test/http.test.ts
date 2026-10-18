import { describe, expect, test } from 'bun:test'
import {
  CACHE_ANONYMOUS,
  CACHE_PRIVATE,
  etagMatches,
  finishResponse,
  hasSessionCookie,
  negotiateEncoding,
  pageCacheControl,
} from '../src/lib/http.ts'

describe('the cache-header switch', () => {
  test('anonymous requests are publicly cacheable', () => {
    expect(pageCacheControl(null)).toBe(CACHE_ANONYMOUS)
    expect(CACHE_ANONYMOUS).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=300')
    expect(pageCacheControl('theme=dark; other=1')).toBe(CACHE_ANONYMOUS)
    expect(pageCacheControl('heka_session_old=1')).toBe(CACHE_ANONYMOUS)
  })

  test('the session cookie makes a response private, no-store', () => {
    expect(hasSessionCookie('heka_session=abc')).toBe(true)
    expect(hasSessionCookie('a=1; heka_session=')).toBe(true)
    expect(pageCacheControl('a=1;heka_session=abc')).toBe(CACHE_PRIVATE)
    expect(CACHE_PRIVATE).toBe('private, no-store')
  })

  test('finishResponse applies the switch and varies on Cookie', async () => {
    const page = () => new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } })
    const anon = await finishResponse(new Request('http://x/'), page())
    expect(anon.headers.get('Cache-Control')).toBe(CACHE_ANONYMOUS)
    expect(anon.headers.get('Vary')).toContain('Cookie')
    const member = await finishResponse(
      new Request('http://x/', { headers: { cookie: 'heka_session=abc' } }),
      page(),
    )
    expect(member.headers.get('Cache-Control')).toBe(CACHE_PRIVATE)
  })

  test('a route that sets its own Cache-Control keeps it', async () => {
    const res = await finishResponse(
      new Request('http://x/a.css', { headers: { cookie: 'heka_session=abc' } }),
      new Response('a', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
    )
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  test('non-GET responses are not stored', async () => {
    const res = await finishResponse(
      new Request('http://x/', { method: 'POST' }),
      new Response('ok'),
    )
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('ETag and 304', () => {
  test('weak comparison', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"x", W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('*', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"abd"', 'W/"abc"')).toBe(false)
    expect(etagMatches(null, 'W/"abc"')).toBe(false)
  })

  test('a matching If-None-Match gets an empty 304', async () => {
    const page = () => new Response('<p>same</p>', { headers: { 'Content-Type': 'text/html' } })
    const first = await finishResponse(new Request('http://x/'), page())
    const etag = first.headers.get('ETag')
    expect(etag).toMatch(/^W\/"/)
    const second = await finishResponse(
      new Request('http://x/', { headers: { 'if-none-match': etag ?? '' } }),
      page(),
    )
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })
})

describe('compression', () => {
  test('brotli first, then gzip, honoring q=0', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('br')
    expect(negotiateEncoding('gzip')).toBe('gzip')
    expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip')
    expect(negotiateEncoding('identity')).toBeNull()
    expect(negotiateEncoding(null)).toBeNull()
  })

  test('large text responses are compressed; small ones are not', async () => {
    const big = await finishResponse(
      new Request('http://x/', { headers: { 'accept-encoding': 'br' } }),
      new Response('x'.repeat(5000), { headers: { 'Content-Type': 'text/html' } }),
    )
    expect(big.headers.get('Content-Encoding')).toBe('br')
    const small = await finishResponse(
      new Request('http://x/', { headers: { 'accept-encoding': 'br' } }),
      new Response('tiny', { headers: { 'Content-Type': 'text/html' } }),
    )
    expect(small.headers.get('Content-Encoding')).toBeNull()
  })
})
