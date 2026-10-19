// The Hono app: the reading routes, the session middleware, and the response finishing (cache
// headers, ETag, compression). Signing in, posting and moderating are in src/routes/. createApp
// takes its database, config, clock and GitHub client as arguments so tests run it in memory.

import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import {
  type Config,
  isFoundingModerator,
  PAGE_SIZE,
  RULES,
  SESSION_COOKIE,
  SITE,
} from './config.ts'
import { commentTree, listCommentsByAuthor } from './db/comments.ts'
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
import { getSession, touchSession } from './db/sessions.ts'
import { getTag, listTags } from './db/tags.ts'
import type { ItemKind, ItemSummary } from './db/types.ts'
import { findBranch, getProfile, inviteTree, listUsersForSitemap, treeSummary } from './db/users.ts'
import { votedComments, votedItems } from './db/votes.ts'
import { type Assets, buildAssets } from './lib/assets.ts'
import { robotsTxt, rssFeed, sitemap } from './lib/feeds.ts'
import { CACHE_IMMUTABLE, CACHE_NONE, CACHE_STATIC, finishResponse } from './lib/http.ts'
import { websiteJsonLd } from './lib/jsonld.ts'
import { type GitHubClient, githubClient } from './lib/oauth.ts'
import { rankItems } from './lib/rank.ts'
import {
  clearSessionCookie,
  csrfToken,
  readCookie,
  sessionCookie,
  sessionId,
} from './lib/session.ts'
import { registerAuth } from './routes/auth.tsx'
import { registerItems } from './routes/items.tsx'
import { registerMembers } from './routes/members.tsx'
import { registerModeration } from './routes/moderation.tsx'
import type { AppEnv, C, HtmlStatus, Web } from './routes/web.ts'
import { Csrf } from './views/components/Forms.tsx'
import { WHOS_HERE_LIMIT, WhosHere } from './views/components/WhosHere.tsx'
import type { NavKey, PageContext, SigninMode } from './views/context.ts'
import { ItemPage } from './views/pages/ItemPage.tsx'
import { ListPage } from './views/pages/ListPage.tsx'
import { ModerationPage } from './views/pages/ModerationPage.tsx'
import { AboutPage, ErrorPage, MessagePage } from './views/pages/TextPages.tsx'
import { BranchPage, TreePage } from './views/pages/TreePage.tsx'
import { UserPage } from './views/pages/UserPage.tsx'

export interface AppOptions {
  db: Db
  config: Config
  assets?: Assets
  /** Unix seconds; injectable for tests. */
  clock?: () => number
  /** GitHub's OAuth endpoints; tests pass a fake. Defaults to the real one when configured. */
  github?: GitHubClient | null
}

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/** ?p=N as a page number; null when it is not a positive integer. */
function pageParam(c: C): number | null {
  const raw = c.req.query('p')
  if (raw === undefined) return 1
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null
  return Number(raw)
}

function withPage(path: string, page: number): string {
  return page <= 1 ? path : `${path}?p=${page}`
}

export function createApp(opts: AppOptions): Hono<AppEnv> {
  const { db, config } = opts
  const assets = opts.assets ?? buildAssets()
  const clock = opts.clock ?? (() => Math.floor(Date.now() / 1000))
  const github =
    opts.github !== undefined ? opts.github : config.github ? githubClient(config.github) : null
  const signin: SigninMode = github ? 'github' : config.devSignIn ? 'dev' : 'closed'
  const origin = config.publicUrl
  const app = new Hono<AppEnv>()

  const ctxOf = (c: C): PageContext => {
    const url = new URL(c.req.url)
    const viewer = c.get('viewer') ?? null
    return {
      config,
      assets,
      now: clock(),
      path: url.pathname,
      returnTo: url.pathname + url.search,
      signedIn: viewer !== null,
      viewer,
      signin,
      votes: { items: new Set(), comments: new Set() },
    }
  }

  /** The page context with the viewer's votes on these items filled in. */
  const ctxWithVotes = (c: C, items: ItemSummary[]): PageContext => {
    const ctx = ctxOf(c)
    if (ctx.viewer) {
      ctx.votes.items = votedItems(
        db,
        ctx.viewer.id,
        items.map((item) => item.id),
      )
    }
    return ctx
  }

  // Rendering is synchronous (no async components), so c.html returns a Response, not a Promise.
  const html = (c: C, node: Child, status: HtmlStatus = 200): Response =>
    c.html(`<!doctype html>${String(node)}`, status) as Response

  const notFound = (c: C) => html(c, <ErrorPage ctx={ctxOf(c)} status={404} />, 404)

  const refuse: Web['refuse'] = (c, message, status = 403) =>
    html(
      c,
      <MessagePage ctx={ctxOf(c)} title={message.title}>
        <p class="lede">{message.body}</p>
        <p>
          <a href="/">Back to the top items</a>
        </p>
      </MessagePage>,
      status,
    )

  const web: Web = { db, config, assets, clock, github, signin, ctxOf, html, notFound, refuse }

  // Finish every response: security headers, cache policy, ETag/304, compression.
  app.use('*', async (c, next) => {
    await next()
    c.res = await finishResponse(c.req.raw, c.res)
  })

  // Who is signed in. A cookie for a session that has ended is cleared. A live session's expiry
  // slides forward at most once every RULES.sessionRefresh. Any request carrying the cookie gets
  // `private, no-store` (src/lib/http.ts), whether or not the session is still good.
  app.use('*', async (c, next) => {
    c.set('viewer', null)
    c.set('sessionId', null)
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
    if (token) {
      const id = sessionId(token)
      const now = clock()
      const session = getSession(db, id, now)
      if (session) {
        c.set('viewer', { ...session.member, csrf: csrfToken(config.sessionSecret, id) })
        c.set('sessionId', id)
        if (now - session.lastSeenAt >= RULES.sessionRefresh) {
          touchSession(db, id, now, RULES.sessionTtl)
          c.header('Set-Cookie', sessionCookie(token, config.secureCookies), { append: true })
        }
      } else {
        c.header('Set-Cookie', clearSessionCookie(config.secureCookies), { append: true })
      }
    }
    await next()
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

  app.get('/js/:file', (c) => {
    const body = assets.scripts.get(c.req.path)
    if (body === undefined) return notFound(c)
    return c.body(body, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': CACHE_IMMUTABLE,
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

  const rss = (c: C, body: string) =>
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
    const ranked = rankItems(
      listRankCandidates(db, config.rankCandidates, RULES.flagThreshold),
      clock(),
    )
    const offset = (page - 1) * PAGE_SIZE
    const items = ranked.slice(offset, offset + PAGE_SIZE)
    if (page > 1 && items.length === 0) return notFound(c)
    const ctx = ctxWithVotes(c, items)
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
        aside={
          page === 1 ? <WhosHere ctx={ctx} summary={treeSummary(db, WHOS_HERE_LIMIT)} /> : undefined
        }
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
          ctx={ctxWithVotes(c, rows)}
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
        ctx={ctxWithVotes(c, rows)}
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
    const ctx = ctxOf(c)
    if (item.deleted) {
      const restorable = ctx.viewer?.isModerator && item.removedBy === 'moderator'
      return html(
        c,
        <ErrorPage ctx={ctx} status={410} removedBy={item.removedBy}>
          {restorable && (
            <form class="decide decide--profile" method="post" action={`/item/${item.id}/restore`}>
              <Csrf ctx={ctx} />
              <label class="field__label" for="restore-reason">
                Restore it
              </label>
              <div class="decide__row">
                <input
                  class="input input--small"
                  id="restore-reason"
                  name="reason"
                  required
                  autocomplete="off"
                  placeholder="Reason, for the public log…"
                />
                <button class="button button--small" type="submit">
                  Restore
                </button>
              </div>
            </form>
          )}
        </ErrorPage>,
        410,
      )
    }
    if (ctx.viewer) {
      ctx.votes.items = votedItems(db, ctx.viewer.id, [item.id])
      ctx.votes.comments = votedComments(db, ctx.viewer.id, item.id)
    }
    return html(c, <ItemPage ctx={ctx} item={item} comments={commentTree(db, item.id)} />)
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
    const items = rows.slice(0, PAGE_SIZE)
    return html(
      c,
      <UserPage
        ctx={ctxWithVotes(c, items)}
        user={user}
        founding={user.isModerator && isFoundingModerator(config, user.login)}
        items={items}
        comments={page === 1 ? listCommentsByAuthor(db, user.id, { limit: 10, offset: 0 }) : []}
        page={page}
        hasNext={rows.length > PAGE_SIZE}
      />,
    )
  })

  app.get('/tree', (c) => html(c, <TreePage ctx={ctxOf(c)} roots={inviteTree(db)} />))

  // One member as their own root: the line above them and the branch below (ADR 0003).
  app.get('/tree/:login', (c) => {
    const user = getProfile(db, c.req.param('login'))
    if (!user) return notFound(c)
    if (c.req.param('login') !== user.login) return c.redirect(`/tree/${user.login}`, 301)
    const branch = findBranch(inviteTree(db), user.login)
    if (!branch) return notFound(c)
    return html(c, <BranchPage ctx={ctxOf(c)} line={branch.line} node={branch.node} />)
  })

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

  registerAuth(app, web)
  registerItems(app, web)
  registerMembers(app, web)
  registerModeration(app, web)

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
