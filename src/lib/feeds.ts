// RSS 2.0 feeds, the sitemap and robots.txt, as strings. Pure functions of their inputs.

import { SITE } from '../config.ts'
import type { ItemSummary, SitemapEntry } from '../db/types.ts'
import { plural, readingMinutes } from './format.ts'
import { excerpt, htmlToText } from './markdown.ts'

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function cdata(text: string): string {
  return `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

export interface FeedItem extends ItemSummary {
  /** Rendered body for posts and status notes. */
  fullHtml: string
}

function feedTitle(item: FeedItem): string {
  return item.title ?? `${item.author.login}: ${excerpt(htmlToText(item.fullHtml), 80)}`
}

function feedDescription(origin: string, item: FeedItem): string {
  const discuss = `<p><a href="${origin}/item/${item.id}">${plural(item.commentCount, 'comment')}</a>, ${plural(item.points, 'point')}</p>`
  if (item.kind === 'link') {
    return `${item.fullHtml}<p>Link: <a href="${escapeXml(item.url ?? '')}">${escapeXml(item.domain ?? '')}</a></p>${discuss}`
  }
  if (item.kind === 'post') {
    return `<p>${readingMinutes(item.bodyChars)} min read</p>${item.fullHtml}${discuss}`
  }
  return `${item.fullHtml}${discuss}`
}

/** An RSS 2.0 channel of items. */
export function rssFeed(opts: {
  origin: string
  selfPath: string
  title: string
  description: string
  items: FeedItem[]
  now: number
}): string {
  const { origin } = opts
  const entries = opts.items
    .map((item) => {
      const page = `${origin}/item/${item.id}`
      const link = item.kind === 'link' && item.url ? item.url : page
      return `    <item>
      <title>${escapeXml(feedTitle(item))}</title>
      <link>${escapeXml(link)}</link>
      <comments>${page}</comments>
      <guid isPermaLink="true">${page}</guid>
      <pubDate>${new Date(item.createdAt * 1000).toUTCString()}</pubDate>
      <dc:creator>${escapeXml(item.author.login)}</dc:creator>
${item.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
      <description>${cdata(feedDescription(origin, item))}</description>
    </item>`
    })
    .join('\n')
  const updated = opts.items[0]?.createdAt ?? opts.now
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${origin}/</link>
    <description>${escapeXml(opts.description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(updated * 1000).toUTCString()}</lastBuildDate>
    <atom:link href="${origin}${opts.selfPath}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`
}

export function sitemap(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastModified
        ? `<lastmod>${new Date(entry.lastModified * 1000).toISOString()}</lastmod>`
        : ''
      return `  <url><loc>${escapeXml(`${origin}${entry.path}`)}</loc>${lastmod}</url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

export function robotsTxt(origin: string): string {
  return `# ${SITE.name}: everything public may be crawled.
User-agent: *
Disallow: /signin

Sitemap: ${origin}/sitemap.xml
`
}
