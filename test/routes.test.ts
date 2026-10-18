import { describe, expect, test } from 'bun:test'
import { getItem, listNewest } from '../src/db/items.ts'
import { jsonLd, makeApp, ORIGIN, SHA } from './helpers.ts'

const { db, get } = makeApp()

const post = listNewest(db, { kind: 'post', limit: 50, offset: 0 }).find((i) =>
  i.title?.startsWith('Holdout'),
)
const status = listNewest(db, { kind: 'status', limit: 1, offset: 0 })[0]
const link = listNewest(db, { kind: 'link', limit: 50, offset: 0 }).find((i) =>
  i.title?.startsWith('Show: an open-source vault'),
)
const removed = db.query<{ id: number }, []>('SELECT id FROM items WHERE deleted = 1 LIMIT 1').get()
if (!post || !status || !link || !removed) throw new Error('seed data is missing a fixture')

const PAGES = [
  '/',
  '/newest',
  '/posts',
  '/status',
  `/item/${post.id}`,
  `/item/${status.id}`,
  `/item/${link.id}`,
  '/t/harness',
  '/u/ledgerline',
  '/u/sapling',
  '/tree',
  '/moderation',
  '/about',
  '/signin',
]

describe('status codes', () => {
  for (const path of PAGES) {
    test(`${path} is 200 HTML`, async () => {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/html')
    })
  }

  for (const path of [
    '/nope',
    '/item/0',
    '/item/abc',
    '/item/999999',
    '/u/nobody',
    '/t/nothing',
    '/?p=0',
    '/?p=abc',
    '/newest?p=99',
    '/assets/app.css',
    '/fonts/x/y.woff2',
  ]) {
    test(`${path} is a real 404 page`, async () => {
      const res = await get(path)
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toContain('<h1>Nothing at this address</h1>')
      expect(html).toContain('<meta name="robots" content="noindex"/>')
    })
  }

  test('a removed item is 410 Gone and points at the moderation log', async () => {
    const res = await get(`/item/${removed.id}`)
    expect(res.status).toBe(410)
    expect(await res.text()).toContain('href="/moderation"')
  })

  test('trailing slashes and login case redirect to the canonical URL', async () => {
    const slash = await get('/about/')
    expect(slash.status).toBe(301)
    expect(slash.headers.get('Location')).toBe('/about')
    const login = await get('/u/LEDGERLINE')
    expect(login.status).toBe(301)
    expect(login.headers.get('Location')).toBe('/u/ledgerline')
  })

  test('/healthz reports the commit and is never cached', async () => {
    const res = await get('/healthz')
    expect(await res.text()).toBe(`ok ${SHA}`)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('works without JavaScript', () => {
  for (const path of PAGES) {
    test(`${path} ships no script but structured data`, async () => {
      const html = await (await get(path)).text()
      const scripts = html.match(/<script\b[^>]*>/g) ?? []
      for (const tag of scripts) expect(tag).toBe('<script type="application/ld+json">')
      expect(html).not.toMatch(/\son[a-z]+=/i)
    })
  }

  test('comment threads fold with <details>, open by default', async () => {
    const html = await (await get(`/item/${post.id}`)).text()
    expect(html).toContain('<details class="c-fold" open="">')
    expect(html).toMatch(/<summary class="c-toggle" aria-label="Comment by [\w-]+"><\/summary>/)
  })

  test('voting while signed out explains sign-in instead of failing', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain(`href="/signin?next=%2Fitem%2F`)
    const signin = await (await get('/signin?next=//evil.example.com')).text()
    expect(signin).toContain('Membership is by invitation; sign-in opens soon.')
    expect(signin).toContain('<a href="/">Back to where you were</a>')
  })
})

describe('SEO', () => {
  test('every page has its own title, description and canonical URL', async () => {
    const seen = new Map<string, string>()
    for (const path of PAGES) {
      const html = await (await get(path)).text()
      const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
      expect(title.length).toBeGreaterThan(0)
      expect(seen.has(title)).toBe(false)
      seen.set(title, path)
      expect(html).toMatch(/<meta name="description" content="[^"]{20,}"\/>/)
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${path.split('?')[0]}"/>`)
      expect(html).toContain('<meta property="og:title"')
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    }
  })

  test('a post is a DiscussionForumPosting with counts and nested comments', async () => {
    const [data] = jsonLd(await (await get(`/item/${post.id}`)).text())
    expect(data?.['@type']).toBe('DiscussionForumPosting')
    expect(data?.headline).toBe(post.title)
    expect(data?.url).toBe(`${ORIGIN}/item/${post.id}`)
    const stats = data?.interactionStatistic as Record<string, unknown>[]
    expect(stats).toContainEqual({
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/LikeAction',
      userInteractionCount: post.points,
    })
    const comments = data?.comment as { '@type': string; comment?: unknown[] }[]
    expect(comments[0]?.['@type']).toBe('Comment')
    expect(comments.some((c) => Array.isArray(c.comment))).toBe(true)
  })

  test('a link shares its URL; a status note is a SocialMediaPosting', async () => {
    const [linkData] = jsonLd(await (await get(`/item/${link.id}`)).text())
    expect(linkData?.['@type']).toBe('DiscussionForumPosting')
    expect(linkData?.sharedContent).toEqual({ '@type': 'WebPage', url: link.url })
    const [statusData] = jsonLd(await (await get(`/item/${status.id}`)).text())
    expect(statusData?.['@type']).toBe('SocialMediaPosting')
    expect(statusData?.headline).toBeUndefined()
  })

  test('outbound user links are nofollow ugc', async () => {
    const html = await (await get('/')).text()
    for (const [, href, rel] of html.matchAll(/<a href="(https?:[^"]+)" rel="([^"]*)"/g)) {
      if (href?.startsWith(ORIGIN)) continue
      expect(rel).toBe('nofollow ugc noopener')
    }
    const body = getItem(db, post.id)?.bodyHtml ?? ''
    expect(body).not.toMatch(/<a href="https?:[^"]+"(?! rel="nofollow ugc noopener")/)
  })

  test('JSON-LD cannot be closed early by user text', async () => {
    const html = await (await get(`/item/${post.id}`)).text()
    const block = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? ''
    expect(block).not.toContain('<')
  })
})

describe('caching', () => {
  test('anonymous pages are shared-cacheable; a session cookie makes them private', async () => {
    const anon = await get('/')
    expect(anon.headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    )
    const member = await get('/', { cookie: 'heka_session=x' })
    expect(member.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('the ETag answers 304', async () => {
    const first = await get('/about')
    const etag = first.headers.get('ETag') ?? ''
    const second = await get('/about', { 'if-none-match': etag })
    expect(second.status).toBe(304)
  })

  test('the stylesheet is inline; fonts are immutable', async () => {
    const res = await get('/', { 'accept-encoding': 'br, gzip' })
    expect(res.headers.get('Content-Encoding')).toBe('br')
    const html = await (await get('/')).text()
    expect(html).toMatch(/<style>@font-face\{/)
    expect(html).not.toContain('rel="stylesheet"')
    const font = html.match(/<link rel="preload" href="([^"]+)"/)?.[1] ?? ''
    const fontRes = await get(font)
    expect(fontRes.status).toBe(200)
    expect(fontRes.headers.get('Content-Type')).toBe('font/woff2')
    expect(fontRes.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })
})

describe('feeds and crawlers', () => {
  test('/rss is RSS 2.0 with the newest items', async () => {
    const res = await get('/rss')
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml')
    const xml = await res.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain(`<atom:link href="${ORIGIN}/rss"`)
    expect((xml.match(/<item>/g) ?? []).length).toBeGreaterThan(10)
  })

  test('a tag has its own feed; an unknown tag 404s', async () => {
    const xml = await (await get('/t/security/rss')).text()
    expect(xml).toContain('<category>security</category>')
    expect((await get('/t/nothing/rss')).status).toBe(404)
  })

  test('the sitemap lists pages, tags, members and live items only', async () => {
    const xml = await (await get('/sitemap.xml')).text()
    expect(xml).toContain(`<loc>${ORIGIN}/item/${post.id}</loc>`)
    expect(xml).toContain(`<loc>${ORIGIN}/t/harness</loc>`)
    expect(xml).toContain(`<loc>${ORIGIN}/u/ledgerline</loc>`)
    expect(xml).not.toContain(`/item/${removed.id}<`)
    expect(xml).not.toContain('/u/growth-hacker-9000<')
  })

  test('robots.txt points at the sitemap', async () => {
    expect(await (await get('/robots.txt')).text()).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  })
})

describe('an empty site (production on day one)', () => {
  const empty = makeApp({ seed: false })
  for (const path of ['/', '/newest', '/posts', '/status', '/tree', '/moderation']) {
    test(`${path} shows an empty state, not an error`, async () => {
      const res = await empty.get(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('class="empty"')
    })
  }
})
