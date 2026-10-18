// The Hono app: every route, and the response finishing (cache headers, ETag, compression).
// createApp takes its database, config and clock as arguments so tests run it in memory.

import { type Context, Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { type Config, PAGE_SIZE, SITE } from './config.ts'
import { commentTree } from './db/comments.ts'
import type { Db } from './db/index.ts'
import {
  getItem,
  listByAuthor,
  listByTag,
  listFeedItems,
  listItemsForSitemap,
  listNewest,
  listRankCandidates,
} from './db/items.ts'
import { listModLog } from './db/modlog.ts'
import { getTag, listTags } from './db/tags.ts'
import type { ItemKind } from './db/types.ts'
import { getProfile, inviteTree, listUsersForSitemap } from './db/users.ts'
import { type Assets, buildAssets } from './lib/assets.ts'
import { robotsTxt, rssFeed, sitemap } from './lib/feeds.ts'
import { CACHE_IMMUTABLE, CACHE_NONE, CACHE_STATIC, finishResponse } from './lib/http.ts'
import { websiteJsonLd } from './lib/jsonld.ts'
import { rankItems } from './lib/rank.ts'
import type { NavKey, PageContext } from './views/context.ts'
import { ItemPage } from './views/pages/ItemPage.tsx'
import { ListPage } from './views/pages/ListPage.tsx'
import { ModerationPage } from './views/pages/ModerationPage.tsx'
import { AboutPage, ErrorPage, SigninPage, safeNext } from './views/pages/TextPages.tsx'
import { TreePage } from './views/pages/TreePage.tsx'
import { UserPage } from './views/pages/UserPage.tsx'

export interface AppOptions {
  db: Db
  config: Config
  assets?: Assets
  /** Unix seconds; injectable for tests. */
  clock?: () => number
}

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/** ?p=N as a page number; null when it is not a positive integer. */
function pageParam(c: Context): number | null {
  const raw = c.req.query('p')
  if (raw === undefined) return 1
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null
  return Number(raw)
}

function withPage(path: string, page: number): string {
  return page <= 1 ? path : `${path}?p=${page}`
}

export function createApp(opts: AppOptions): Hono {
  const { db, config } = opts
  const assets = opts.assets ?? buildAssets()
  const clock = opts.clock ?? (() => Math.floor(Date.now() / 1000))
  const origin = config.publicUrl
  const app = new Hono()

  const ctxOf = (c: Context): PageContext => {
    const url = new URL(c.req.url)
    return {
      config,
      assets,
      now: clock(),
      path: url.pathname,
      returnTo: url.pathname + url.search,
      signedIn: false,
    }
  }

  const html = (c: Context, node: Child, status: 200 | 404 | 410 = 200) =>
    c.html(`<!doctype html>${String(node)}`, status)

  const notFound = (c: Context) => html(c, <ErrorPage ctx={ctxOf(c)} status={404} />, 404)

  // Finish every response: security headers, cache policy, ETag/304, compression.
  app.use('*', async (c, next) => {
    await next()
    c.res = await finishResponse(c.req.raw, c.res)
  })

  // Canonical URLs have no trailing slash.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      return c.redirect(url.pathname.replace(/\/+$/, '') + url.search, 301)
    }
    await next()
  })

  // --- Operations and static files ------------------------------------------------------------

  app.get('/healthz', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    return c.text(`ok ${config.gitSha}`)
  })

  app.get('/fonts/:dir/:file', (c) => {
    const file = assets.fonts.get(c.req.path)
    if (!file) return notFound(c)
    return new Response(Bun.file(file), {
      headers: {
        'Content-Type': 'font/woff2',
        'Cache-Control': CACHE_IMMUTABLE,
        'Access-Control-Allow-Origin': '*',
      },
    })
  })

  app.get('/robots.txt', (c) => {
    c.header('Cache-Control', CACHE_STATIC)
    return c.text(robotsTxt(origin))
  })

  app.get('/sitemap.xml', (c) => {
    const statics = ['/', '/newest', '/posts', '/status', '/about', '/tree', '/moderation']
    const entries = [
      ...statics.map((path) => ({ path, lastModified: 0 })),
      ...listTags(db).map((tag) => ({ path: `/t/${tag.name}`, lastModified: 0 })),
      ...listUsersForSitemap(db).map((u) => ({ path: `/u/${u.login}`, lastModified: 0 })),
      ...listItemsForSitemap(db),
    ]
    return c.body(sitemap(origin, entries), 200, {
      'Content-Type': 'application/xml; charset=utf-8',
    })
  })

  const rss = (c: Context, body: string) =>
    c.body(body, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' })

  app.get('/rss', (c) =>
    rss(
      c,
      rssFeed({
        origin,
        selfPath: '/rss',
        title: `${SITE.name}: newest`,
        description: SITE.description,
        items: listFeedItems(db, { limit: PAGE_SIZE }),
        now: clock(),
      }),
    ),
  )

  app.get('/t/:tag/rss', (c) => {
    const tag = getTag(db, c.req.param('tag'))
    if (!tag) return notFound(c)
    return rss(
      c,
      rssFeed({
        origin,
        selfPath: `/t/${tag.name}/rss`,
        title: `${SITE.name}: ${tag.name}`,
        description: tag.description || `Items tagged ${tag.name} on ${SITE.name}.`,
        items: listFeedItems(db, { tag: tag.name, limit: PAGE_SIZE }),
        now: clock(),
      }),
    )
  })

  // --- Lists ------------------------------------------------------------------------------------

  const emptySite = {
    title: 'Nothing has been posted yet.',
    body: (
      <p>
        Members post links, long posts and status notes here, and anyone can read them. Membership
        is by invitation: <a href="/about#membership">how it works</a>. The{' '}
        <a href="/rss">RSS feed</a> will carry the first items as they arrive.
      </p>
    ),
  }

  app.get('/', (c) => {
    const page = pageParam(c)
    if (page === null) return notFound(c)
    const ctx = ctxOf(c)
    const ranked = rankItems(listRankCandidates(db, config.rankCandidates), ctx.now)
    const offset = (page - 1) * PAGE_SIZE
    const items = ranked.slice(offset, offset + PAGE_SIZE)
    if (page > 1 && items.length === 0) return notFound(c)
    const hasNext = ranked.length > offset + PAGE_SIZE
    return html(
      c,
      <ListPage
        ctx={ctx}
        title={page > 1 ? `Top items, page ${page}` : undefined}
        canonical={withPage('/', page)}
        nav="top"
        heading={page > 1 ? `Top items, page ${page}` : 'Top items'}
        headingHidden
        items={items}
        rankFrom={offset + 1}
        prev={
          page > 1 ? { href: withPage('/', page - 1), label: 'Higher-ranked items' } : undefined
        }
        next={
          hasNext
            ? { href: withPage('/', page + 1), label: `Items ${offset + PAGE_SIZE + 1} onward` }
            : undefined
        }
        empty={emptySite}
        jsonLd={page === 1 ? [websiteJsonLd(origin)] : undefined}
      />,
    )
  })

  const chronological = (opts: {
    path: string
    nav: NavKey
    kind?: ItemKind
    title: string
    description: string
    intro?: Child
    fullNotes?: boolean
    empty: { title: string; body: Child }
  }) =>
    app.get(opts.path, (c) => {
      const page = pageParam(c)
      if (page === null) return notFound(c)
      const rows = listNewest(db, {
        kind: opts.kind,
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (page > 1 && rows.length === 0) return notFound(c)
      const title = page > 1 ? `${opts.title}, page ${page}` : opts.title
      return html(
        c,
        <ListPage
          ctx={ctxOf(c)}
          title={title}
          description={opts.description}
          canonical={withPage(opts.path, page)}
          nav={opts.nav}
          heading={title}
          intro={opts.intro}
          fullNotes={opts.fullNotes}
          items={rows.slice(0, PAGE_SIZE)}
          prev={
            page > 1 ? { href: withPage(opts.path, page - 1), label: 'Newer items' } : undefined
          }
          next={
            rows.length > PAGE_SIZE
              ? { href: withPage(opts.path, page + 1), label: 'Older items' }
              : undefined
          }
          empty={opts.empty}
        />,
      )
    })

  chronological({
    path: '/newest',
    nav: 'new',
    title: 'Newest',
    description: 'The newest links, posts and status notes on heka news, newest first.',
    empty: emptySite,
  })
  chronological({
    path: '/posts',
    nav: 'posts',
    kind: 'post',
    title: 'Posts',
    description:
      'Long-form posts by heka news members about building software with coding agents. Published here and nowhere else.',
    intro: <p>Long-form writing by members, published here and nowhere else.</p>,
    empty: {
      title: 'No posts yet.',
      body: <p>Long-form posts by members will be listed here, newest first.</p>,
    },
  })
  chronological({
    path: '/status',
    nav: 'status',
    kind: 'status',
    title: 'Status',
    description:
      'Short status notes from heka news members: what they are building, reading or stuck on.',
    intro: <p>Short notes from members: what they are building, reading or stuck on.</p>,
    fullNotes: true,
    empty: {
      title: 'No status notes yet.',
      body: <p>Short notes from members, up to 500 characters each, will appear here.</p>,
    },
  })

  app.get('/t/:tag', (c) => {
    const page = pageParam(c)
    const tag = getTag(db, c.req.param('tag'))
    if (page === null || !tag) return notFound(c)
    const path = `/t/${tag.name}`
    const rows = listByTag(db, tag.name, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE })
    if (page > 1 && rows.length === 0) return notFound(c)
    const title = page > 1 ? `Tagged ${tag.name}, page ${page}` : `Tagged ${tag.name}`
    return html(
      c,
      <ListPage
        ctx={ctxOf(c)}
        title={title}
        description={
          tag.description
            ? `${tag.description} Items tagged ${tag.name} on heka news.`
            : `Items tagged ${tag.name} on heka news, newest first.`
        }
        canonical={withPage(path, page)}
        nav={null}
        heading={title}
        intro={
          <p>
            {tag.description && `${tag.description} `}
            <a href={`${path}/rss`}>RSS feed for {tag.name}</a>
          </p>
        }
        items={rows.slice(0, PAGE_SIZE)}
        prev={page > 1 ? { href: withPage(path, page - 1), label: 'Newer items' } : undefined}
        next={
          rows.length > PAGE_SIZE
            ? { href: withPage(path, page + 1), label: 'Older items' }
            : undefined
        }
        empty={{
          title: `Nothing is tagged ${tag.name} yet.`,
          body: <p>Items with this tag will appear here, newest first.</p>,
        }}
        feeds={[{ title: `heka news: ${tag.name}`, href: `${path}/rss` }]}
      />,
    )
  })

  // --- Items, members, the community ----------------------------------------------------------

  app.get('/item/:id', (c) => {
    const id = c.req.param('id')
    if (!/^[1-9]\d{0,15}$/.test(id)) return notFound(c)
    const item = getItem(db, Number(id))
    if (!item) return notFound(c)
    if (item.deleted) return html(c, <ErrorPage ctx={ctxOf(c)} status={410} />, 410)
    return html(c, <ItemPage ctx={ctxOf(c)} item={item} comments={commentTree(db, item.id)} />)
  })

  app.get('/u/:login', (c) => {
    const page = pageParam(c)
    const user = getProfile(db, c.req.param('login'))
    if (page === null || !user) return notFound(c)
    // One URL per member: /u/Login redirects to /u/login as stored.
    if (c.req.param('login') !== user.login) {
      return c.redirect(withPage(`/u/${user.login}`, page), 301)
    }
    const rows = listByAuthor(db, user.login, {
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE,
    })
    if (page > 1 && rows.length === 0) return notFound(c)
    return html(
      c,
      <UserPage
        ctx={ctxOf(c)}
        user={user}
        items={rows.slice(0, PAGE_SIZE)}
        page={page}
        hasNext={rows.length > PAGE_SIZE}
      />,
    )
  })

  app.get('/tree', (c) => html(c, <TreePage ctx={ctxOf(c)} roots={inviteTree(db)} />))

  app.get('/moderation', (c) => {
    const page = pageParam(c)
    if (page === null) return notFound(c)
    const rows = listModLog(db, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE })
    if (page > 1 && rows.length === 0) return notFound(c)
    return html(
      c,
      <ModerationPage
        ctx={ctxOf(c)}
        entries={rows.slice(0, PAGE_SIZE)}
        page={page}
        hasNext={rows.length > PAGE_SIZE}
      />,
    )
  })

  app.get('/about', (c) => html(c, <AboutPage ctx={ctxOf(c)} tags={listTags(db)} />))

  app.get('/signin', (c) =>
    html(c, <SigninPage ctx={ctxOf(c)} next={safeNext(c.req.query('next'))} />),
  )

  // public/: favicon, touch icon, Open Graph image.
  app.get('/:file', async (c, next) => {
    const file = assets.publicFiles.get(c.req.path)
    if (!file) return next()
    const ext = file.slice(file.lastIndexOf('.'))
    return new Response(Bun.file(file), {
      headers: {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': CACHE_STATIC,
      },
    })
  })

  app.notFound(notFound)

  app.onError((error, c) => {
    console.error(error)
    c.header('Cache-Control', CACHE_NONE)
    return c.text('Something went wrong on our side. Try again in a minute.', 500)
  })

  return app
}
