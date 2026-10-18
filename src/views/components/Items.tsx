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

const TALLY = (
  <svg viewBox="0 0 10 22" aria-hidden="true">
    <path d="M5 1 L9 6 V21 H1 V6 Z" />
  </svg>
)

function Points({ points, anchor }: { points: number; anchor: string }) {
  return (
    <span class="vote__points" data-points={anchor}>
      <span class="vote__count">{formatNumber(points)}</span>
      <span class="sr-only"> {points === 1 ? 'point' : 'points'}</span>
    </span>
  )
}

/**
 * The upvote: a tally mark with a point, over the count. Signed out, it is a link that explains
 * sign-in. Signed in, it is a form with one toggle button (src/client/vote.ts sends it without a
 * reload). On the viewer's own item the mark is already filled: their own point, which every item
 * starts with (ADR 0004), and it cannot be taken back.
 */
export function VoteMark(props: {
  ctx: PageContext
  /** "item" or "comment", and its id. */
  kind: 'item' | 'comment'
  id: number
  authorId: number
  /** Where the plain form returns to. */
  target: string
  label: string
  points: number
}) {
  const { ctx } = props
  const size = props.kind
  const anchor = props.kind === 'item' ? `i${props.id}` : `c${props.id}`
  const showPoints = size !== 'comment'
  if (!ctx.viewer) {
    const next = encodeURIComponent(props.target)
    return (
      <div class={`vote vote--${size}`}>
        <a class="vote__mark" href={`/signin?next=${next}`} rel="nofollow" title="Upvote">
          {TALLY}
          <span class="sr-only">Upvote {props.label} (members only)</span>
        </a>
        {showPoints && <Points points={props.points} anchor={anchor} />}
      </div>
    )
  }
  if (ctx.viewer.id === props.authorId) {
    return (
      <div class={`vote vote--${size}`}>
        <span class="vote__mark vote__mark--own" title="Your own point">
          {TALLY}
          <span class="sr-only">Your own point on {props.label}</span>
        </span>
        {showPoints && <Points points={props.points} anchor={anchor} />}
      </div>
    )
  }
  const voted = (props.kind === 'item' ? ctx.votes.items : ctx.votes.comments).has(props.id)
  const action = props.kind === 'item' ? `/item/${props.id}/vote` : `/c/${props.id}/vote`
  return (
    <form
      class={`vote vote--${size}`}
      method="post"
      action={action}
      data-target={anchor}
      data-current={props.points}
    >
      <input type="hidden" name="csrf" value={ctx.viewer.csrf} />
      <input type="hidden" name="next" value={props.target} />
      <button
        class="vote__mark"
        type="submit"
        name="dir"
        value={voted ? 'un' : 'up'}
        aria-pressed={voted ? 'true' : 'false'}
        title={voted ? 'Take back your vote' : 'Upvote'}
      >
        {TALLY}
        <span class="sr-only">Upvote {props.label}</span>
      </button>
      {showPoints && <Points points={props.points} anchor={anchor} />}
    </form>
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
  fullNotes = false,
}: {
  item: ItemSummary
  ctx: PageContext
  rank?: number
  /** Show status notes whole (the status feed) instead of clamped to three lines. */
  fullNotes?: boolean
}) {
  const href = `/item/${item.id}`
  return (
    <li class="item" data-kind={item.kind} id={`i${item.id}`}>
      {rank !== undefined && <span class="item__rank">{rank}</span>}
      <VoteMark
        ctx={ctx}
        kind="item"
        id={item.id}
        authorId={item.authorId}
        target={`${ctx.returnTo}#i${item.id}`}
        label={itemLabel(item)}
        points={item.points}
      />
      <div class="item__main">
        {item.kind === 'status' ? (
          <div class={fullNotes ? 'note' : 'note note--clamped'} dir="auto">
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
  fullNotes,
}: {
  items: ItemSummary[]
  ctx: PageContext
  /** Show ranks starting at this number (the front page). */
  rankFrom?: number
  fullNotes?: boolean
}) {
  const rows = items.map((item, i) => (
    <ItemRow
      item={item}
      ctx={ctx}
      rank={rankFrom === undefined ? undefined : rankFrom + i}
      fullNotes={fullNotes}
    />
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
