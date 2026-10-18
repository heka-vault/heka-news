// Every page's shell: the <head> (title, description, canonical, Open Graph, Twitter, structured
// data, feeds), the site bar, and the footer. Pages pass only what differs from the defaults.

import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { SITE } from '../../config.ts'
import { absoluteUrl, type NavKey, type PageContext } from '../context.ts'
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
  children?: Child
}

const NAV: { key: Exclude<NavKey, null>; href: string; label: string }[] = [
  { key: 'top', href: '/', label: 'Top' },
  { key: 'new', href: '/newest', label: 'New' },
  { key: 'posts', href: '/posts', label: 'Posts' },
  { key: 'status', href: '/status', label: 'Status' },
]

/** JSON in a <script>: "<" escaped so a title cannot close the element. */
export function jsonLdScript(data: object) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json">{raw(json)}</script>
}

export function Layout(props: LayoutProps) {
  const { ctx } = props
  const fullTitle = props.title ? `${props.title} | ${SITE.name}` : SITE.name
  const description = props.description ?? SITE.description
  const canonical = absoluteUrl(ctx, props.canonical ?? ctx.path)
  const image = absoluteUrl(ctx, '/og.png')
  const signinHref = `/signin?next=${encodeURIComponent(ctx.returnTo)}`

  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        {props.noindex && <meta name="robots" content="noindex" />}
        <meta name="theme-color" content="#1f4235" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#1b3a2f" media="(prefers-color-scheme: dark)" />
        <meta name="color-scheme" content="light dark" />
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
                {NAV.map((item) => (
                  <li>
                    <a href={item.href} aria-current={props.nav === item.key ? 'page' : undefined}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <a class="bar__signin" href={signinHref} rel="nofollow">
              Sign in
            </a>
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
