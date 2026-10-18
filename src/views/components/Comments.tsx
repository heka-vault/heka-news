// Threaded comments. Each thread folds with <details>, so folding works without JavaScript. The
// head row (author, time, points) stays visible when a thread is folded; the toggle sits at its
// left edge, and a folded thread says how many replies it hides. Indentation stops growing after
// a few levels on narrow screens (app.css, .c-children--deep) so deep threads keep a usable measure.
//
// Signed in, each comment gets a row of actions under its text: reply (in place with
// src/client/reply.ts, or on its own page), edit for two hours, delete, flag, and remove for
// moderators.

import { raw } from 'hono/html'
import { RULES } from '../../config.ts'
import { countTree } from '../../db/comments.ts'
import type { CommentNode } from '../../db/types.ts'
import { plural } from '../../lib/format.ts'
import { canEdit, isMine, type PageContext } from '../context.ts'
import { VoteMark } from './Items.tsx'
import { Time } from './Time.tsx'

/** Depth from which indentation shrinks on phones, and from which it shrinks everywhere. */
const DEEP_ON_PHONES = 3
const DEEP_EVERYWHERE = 8

export function childClass(depth: number): string {
  if (depth >= DEEP_EVERYWHERE) return 'c-children c-children--deep c-children--deeper'
  if (depth >= DEEP_ON_PHONES) return 'c-children c-children--deep'
  return 'c-children'
}

function Actions({ node, ctx }: { node: CommentNode; ctx: PageContext }) {
  const viewer = ctx.viewer
  if (!viewer || node.deleted) return null
  const mine = isMine(ctx, node.authorId)
  return (
    <p class="c-actions">
      <a
        class="c-action c-reply"
        href={`/c/${node.id}/reply`}
        data-for={node.id}
        aria-expanded="false"
        rel="nofollow"
      >
        reply
      </a>
      {canEdit(ctx, node.authorId, node.createdAt, RULES.editWindow) && (
        <a class="c-action" href={`/c/${node.id}/edit`} rel="nofollow">
          edit
        </a>
      )}
      {mine && (
        <a class="c-action" href={`/c/${node.id}/delete`} rel="nofollow">
          delete
        </a>
      )}
      {!mine && (
        <a class="c-action" href={`/c/${node.id}/flag`} rel="nofollow">
          flag
        </a>
      )}
      {viewer.isModerator && (
        <a class="c-action" href={`/c/${node.id}/remove`} rel="nofollow">
          remove
        </a>
      )}
    </p>
  )
}

export function Comment({
  node,
  ctx,
  itemId,
}: {
  node: CommentNode
  ctx: PageContext
  itemId: number
}) {
  const anchor = `c${node.id}`
  const hidden = countTree(node.children) + (node.deleted ? 0 : 1)
  return (
    <li class="comment" id={anchor}>
      <div class="c-head">
        {node.deleted ? (
          <span class="c-removed">
            {node.removedBy === 'author' ? '[deleted]' : 'Removed by a moderator'}
          </span>
        ) : (
          <>
            <VoteMark
              ctx={ctx}
              kind="comment"
              id={node.id}
              authorId={node.authorId}
              target={`/item/${itemId}#${anchor}`}
              label={`the comment by ${node.author.login}`}
              points={node.points}
            />
            <a class="c-author" translate="no" href={`/u/${node.author.login}`}>
              {node.author.login}
            </a>{' '}
            <a class="c-time" href={`#${anchor}`}>
              <Time at={node.createdAt} now={ctx.now} />
            </a>{' '}
            <span class="c-points" data-points={anchor} data-unit="point">
              {plural(node.points, 'point')}
            </span>
            {node.editedAt && <span class="c-edited">edited</span>}
          </>
        )}{' '}
        <span class="c-folded">({plural(hidden, 'comment')} folded)</span>
      </div>
      <details class="c-fold" open>
        <summary
          class="c-toggle"
          aria-label={node.deleted ? 'Deleted comment' : `Comment by ${node.author.login}`}
        />
        {!node.deleted && (
          <div class="c-body prose" dir="auto">
            {raw(node.bodyHtml)}
          </div>
        )}
        <Actions node={node} ctx={ctx} />
        {node.children.length > 0 && (
          <ol class={childClass(node.depth + 1)}>
            {node.children.map((child) => (
              <Comment node={child} ctx={ctx} itemId={itemId} />
            ))}
          </ol>
        )}
      </details>
    </li>
  )
}

export function CommentTree(props: { nodes: CommentNode[]; ctx: PageContext; itemId: number }) {
  return (
    <ol class="comments">
      {props.nodes.map((node) => (
        <Comment node={node} ctx={props.ctx} itemId={props.itemId} />
      ))}
    </ol>
  )
}
