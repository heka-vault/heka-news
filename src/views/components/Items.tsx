// A list of items and its parts: the vote mark, the meta line, tags, the pager and the empty
// state. Rows stay dense: rank (front page only), vote mark over the points, title line, meta.

import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import type { ItemSummary } from '../../db/types.ts'
import { formatNumber, plural, readingMinutes } from '../../lib/format.ts'
import { USER_LINK_REL } from '../../lib/markdown.ts'
import type { PageContext } from '../context.ts'
import { Time } from './Time.tsx'

/** A short name for an item in labels: its title, or the start of a status note. */
export function itemLabel(item: { title: string | null; kind: string }): string {
  return item.title ?? 'this status note'
}

/** The upvote: a tally mark with a point, over the count. Signed out, it explains sign-in. */
export function VoteMark(props: {
  ctx: PageContext
  target: string
  label: string
  points: number
  size?: 'item' | 'comment'
}) {
  const next = encodeURIComponent(props.target)
  return (
    <div class={`vote vote--${props.size ?? 'item'}`}>
      <a class="vote__mark" href={`/signin?next=${next}`} rel="nofollow" title="Upvote">
        <svg viewBox="0 0 10 22" aria-hidden="true">
          <path d="M5 1 L9 6 V21 H1 V6 Z" />
        </svg>
        <span class="sr-only">Upvote {props.label} (members only)</span>
      </a>
      {props.size !== 'comment' && (
        <span class="vote__points">
          {formatNumber(props.points)}
          <span class="sr-only"> {props.points === 1 ? 'point' : 'points'}</span>
        </span>
      )}
    </div>
  )
}

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <span class="tags">
      {tags.map((tag) => (
        <a class="tag" href={`/t/${tag}`}>
          {tag}
        </a>
      ))}
    </span>
  )
}

export function ItemRow({
  item,
  ctx,
  rank,
}: {
  item: ItemSummary
  ctx: PageContext
  rank?: number
}) {
  const href = `/item/${item.id}`
  return (
    <li class="item" data-kind={item.kind}>
      {rank !== undefined && <span class="item__rank">{rank}</span>}
      <VoteMark ctx={ctx} target={href} label={itemLabel(item)} points={item.points} />
      <div class="item__main">
        {item.kind === 'status' ? (
          <div class="note note--clamped" dir="auto">
            {raw(item.bodyHtml ?? '')}
          </div>
        ) : (
          <p class="item__title">
            {item.kind === 'link' && item.url ? (
              <a href={item.url} rel={USER_LINK_REL} dir="auto">
                {item.title}
              </a>
            ) : (
              <a href={href} dir="auto" style={`view-transition-name: item-${item.id}`}>
                {item.title}
              </a>
            )}{' '}
            {item.domain && <span class="item__domain">{item.domain}</span>}
            {item.kind === 'post' && (
              <span class="item__kind">post, {readingMinutes(item.bodyChars)} min read</span>
            )}
          </p>
        )}
        <p class="meta">
          <a class="meta__author" translate="no" href={`/u/${item.author.login}`}>
            {item.author.login}
          </a>{' '}
          <a class="meta__time" href={href}>
            <Time at={item.createdAt} now={ctx.now} />
          </a>{' '}
          <a class="meta__comments" href={href}>
            {item.commentCount === 0 ? 'discuss' : plural(item.commentCount, 'comment')}
          </a>{' '}
          <Tags tags={item.tags} />
        </p>
      </div>
    </li>
  )
}

export function ItemList({
  items,
  ctx,
  rankFrom,
}: {
  items: ItemSummary[]
  ctx: PageContext
  /** Show ranks starting at this number (the front page). */
  rankFrom?: number
}) {
  const rows = items.map((item, i) => (
    <ItemRow item={item} ctx={ctx} rank={rankFrom === undefined ? undefined : rankFrom + i} />
  ))
  return rankFrom === undefined ? (
    <ul class="items">{rows}</ul>
  ) : (
    <ol class="items items--ranked" start={rankFrom}>
      {rows}
    </ol>
  )
}

export function Pager(props: {
  prev?: { href: string; label: string }
  next?: { href: string; label: string }
}) {
  if (!props.prev && !props.next) return null
  return (
    <nav class="pager" aria-label="Pages">
      {props.prev && (
        <a href={props.prev.href} rel="prev">
          {props.prev.label}
        </a>
      )}
      {props.next && (
        <a href={props.next.href} rel="next">
          {props.next.label}
        </a>
      )}
    </nav>
  )
}

export function Empty({ title, children }: { title: string; children?: Child }) {
  return (
    <div class="empty">
      <p class="empty__title">{title}</p>
      {children}
    </div>
  )
}
