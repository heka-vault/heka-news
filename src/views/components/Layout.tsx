// Every page's shell: the <head> (title, description, canonical, Open Graph, Twitter, structured
// data, feeds), the site bar, and the footer. Pages pass only what differs from the defaults.

import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { SITE } from '../../config.ts'
import type { ScriptName } from '../../lib/assets.ts'
import { absoluteUrl, type NavKey, type PageContext, type Theme } from '../context.ts'
import { Mark } from './Mark.tsx'

export interface LayoutProps {
  ctx: PageContext
  /** The page's own title; " | heka news" is appended. Omit on the front page. */
  title?: string
  description?: string
  /** Canonical path; defaults to the request path. */
  canonical?: string
  nav?: NavKey
  noindex?: boolean
  ogType?: 'website' | 'article'
  publishedTime?: string
  modifiedTime?: string
  author?: string
  tags?: string[]
  /** schema.org objects, each rendered as its own JSON-LD block. */
  jsonLd?: object[]
  /** Extra feeds for this page (a tag's feed). */
  feeds?: { title: string; href: string }[]
  /** Same-origin modules this page needs, by name (src/client/). Relative times load everywhere. */
  scripts?: ScriptName[]
  children?: Child
}

type NavEntry = {
  key: Exclude<NavKey, null>
  href: string
  label: string
  /** Shown instead of the label where the phone row is too narrow; the label stays the name. */
  short?: string
}

const NAV: NavEntry[] = [
  { key: 'top', href: '/', label: 'Top' },
  { key: 'new', href: '/newest', label: 'New' },
  { key: 'posts', href: '/posts', label: 'Posts' },
  { key: 'status', href: '/status', label: 'Status' },
  { key: 'tree', href: '/tree', label: 'Invite tree', short: 'Tree' },
]

const MEMBER_NAV: NavEntry = { key: 'replies', href: '/replies', label: 'Replies' }
const MOD_NAV: NavEntry = { key: 'mod', href: '/mod', label: 'Mod' }

/** JSON in a <script>: "<" escaped so a title cannot close the element. */
export function jsonLdScript(data: object) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json">{raw(json)}</script>
}

/** A theme-color meta's media: the system decides, unless the visitor chose a theme. */
function themeColorMedia(theme: Theme | null, scheme: Theme): string {
  if (!theme) return `(prefers-color-scheme: ${scheme})`
  return theme === scheme ? 'all' : 'not all'
}

export function Layout(props: LayoutProps) {
  const { ctx } = props
  const fullTitle = props.title ? `${props.title} | ${SITE.name}` : SITE.name
  const description = props.description ?? SITE.description
  const canonical = absoluteUrl(ctx, props.canonical ?? ctx.path)
  const image = absoluteUrl(ctx, '/og.png')
  const signinHref = `/signin?next=${encodeURIComponent(ctx.returnTo)}`
  const viewer = ctx.viewer
  const nav = [...NAV, ...(viewer ? [MEMBER_NAV] : []), ...(viewer?.isModerator ? [MOD_NAV] : [])]
  // Relative times everywhere; votes wherever a member is signed in; then what the page asks for.
  const scripts = [
    ...new Set<ScriptName>([
      'time',
      'theme',
      ...(viewer ? (['vote'] as const) : []),
      ...(props.scripts ?? []),
    ]),
  ]

  return (
    <html lang="en" dir="ltr" data-theme={ctx.theme ?? undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        {props.noindex && <meta name="robots" content="noindex" />}
        {/* A chosen theme pins the browser chrome to its color; otherwise the system picks. */}
        <meta
          name="theme-color"
          content="#1f4235"
          media={themeColorMedia(ctx.theme, 'light')}
          data-scheme="light"
        />
        <meta
          name="theme-color"
          content="#1b3a2f"
          media={themeColorMedia(ctx.theme, 'dark')}
          data-scheme="dark"
        />
        <meta name="color-scheme" content="light dark" />
        {viewer && <meta name="csrf-token" content={viewer.csrf} />}
        {ctx.assets.preloads.map((href) => (
          <link rel="preload" href={href} as="font" type="font/woff2" crossorigin="anonymous" />
        ))}
        <style>{raw(ctx.assets.css)}</style>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="alternate" type="application/rss+xml" title="heka news: newest" href="/rss" />
        {props.feeds?.map((feed) => (
          <link rel="alternate" type="application/rss+xml" title={feed.title} href={feed.href} />
        ))}

        <meta property="og:site_name" content={SITE.name} />
        <meta property="og:locale" content={SITE.locale} />
        <meta property="og:type" content={props.ogType ?? 'website'} />
        <meta property="og:title" content={props.title ?? SITE.name} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={image} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="heka news" />
        {props.publishedTime && (
          <meta property="article:published_time" content={props.publishedTime} />
        )}
        {props.modifiedTime && (
          <meta property="article:modified_time" content={props.modifiedTime} />
        )}
        {props.author && <meta property="article:author" content={props.author} />}
        {props.tags?.map((tag) => (
          <meta property="article:tag" content={tag} />
        ))}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={props.title ?? SITE.name} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={image} />
        {props.jsonLd?.map((data) => jsonLdScript(data))}
        {scripts.map((name) => (
          <script type="module" src={ctx.assets.scriptUrl(name)} />
        ))}
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <header class="bar">
          <div class="wrap bar__inner">
            <a class="wordmark" href="/" aria-label="heka news, top items">
              <Mark size={22} />
              <span translate="no">heka news</span>
            </a>
            <nav class="bar__nav" aria-label="Lists">
              <ul>
                {nav.map((item) => (
                  <li>
                    <a href={item.href} aria-current={props.nav === item.key ? 'page' : undefined}>
                      {item.short ? (
                        <>
                          <span class="bar__nav-long">{item.label}</span>
                          <span class="bar__nav-short" aria-hidden="true">
                            {item.short}
                          </span>
                        </>
                      ) : (
                        item.label
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {viewer ? (
              <div class="bar__member">
                <a
                  class="bar__signin"
                  href="/submit"
                  aria-current={props.nav === null && ctx.path === '/submit' ? 'page' : undefined}
                >
                  Submit
                </a>
                <a class="bar__me" href={`/u/${viewer.login}`} translate="no" title={viewer.login}>
                  <span class="bar__me-login">{viewer.login}</span>
                  <span class="bar__me-short" aria-hidden="true">
                    You
                  </span>
                </a>
              </div>
            ) : (
              <a class="bar__signin" href={signinHref} rel="nofollow">
                Sign in
              </a>
            )}
            <button class="bar__theme" type="button" data-theme-toggle hidden>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path class="bar__theme-moon" d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8z" />
                <g class="bar__theme-sun">
                  <circle cx="10" cy="10" r="3.5" />
                  <path d="M10 1.5v2.2m0 12.6v2.2M1.5 10h2.2m12.6 0h2.2M4 4l1.6 1.6m8.8 8.8L16 16M4 16l1.6-1.6m8.8-8.8L16 4" />
                </g>
              </svg>
            </button>
          </div>
        </header>
        <main id="main" tabindex={-1}>
          {props.children}
        </main>
        <footer class="site-footer">
          <div class="wrap site-footer__grid">
            <div class="site-footer__brand">
              <p class="site-footer__name">
                <Mark size={18} />
                <span translate="no">heka news</span>
              </p>
              <p>
                Run by <a href={SITE.parent.url}>heka</a>, a group of engineers who build software
                factories. Anyone can read. Members are invited.
              </p>
            </div>
            <nav aria-label="About this site">
              <ul>
                <li>
                  <a href="/about">About</a>
                </li>
                <li>
                  <a href="/tree">Invite tree</a>
                </li>
                <li>
                  <a href="/moderation">Moderation log</a>
                </li>
              </ul>
            </nav>
            <nav aria-label="Elsewhere">
              <ul>
                <li>
                  <a href="/rss">RSS feed</a>
                </li>
                <li>
                  <a href={SITE.parent.url}>hekafactory.com</a>
                </li>
                <li>
                  <a href={SITE.source}>Source code</a>
                </li>
              </ul>
            </nav>
            <p class="site-footer__legal">
              © {new Date(ctx.now * 1000).getUTCFullYear()} {SITE.legalName}. The code is MIT
              licensed.
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
