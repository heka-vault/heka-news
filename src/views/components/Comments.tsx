// Threaded comments. Each thread folds with <details>, so folding works without JavaScript. The
// head row (author, time, points) stays visible when a thread is folded; the toggle sits at its
// left edge, and a folded thread says how many replies it hides. Indentation stops growing after
// a few levels on narrow screens (app.css, .c-children--deep) so deep threads keep a usable measure.

import { raw } from 'hono/html'
import { countTree } from '../../db/comments.ts'
import type { CommentNode } from '../../db/types.ts'
import { plural } from '../../lib/format.ts'
import type { PageContext } from '../context.ts'
import { VoteMark } from './Items.tsx'
import { Time } from './Time.tsx'

/** Depth from which indentation shrinks on phones, and from which it shrinks everywhere. */
const DEEP_ON_PHONES = 3
const DEEP_EVERYWHERE = 8

function childClass(depth: number): string {
  if (depth >= DEEP_EVERYWHERE) return 'c-children c-children--deep c-children--deeper'
  if (depth >= DEEP_ON_PHONES) return 'c-children c-children--deep'
  return 'c-children'
}

function Comment({ node, ctx, itemId }: { node: CommentNode; ctx: PageContext; itemId: number }) {
  const anchor = `c${node.id}`
  const hidden = countTree(node.children) + (node.deleted ? 0 : 1)
  return (
    <li class="comment" id={anchor}>
      <div class="c-head">
        {node.deleted ? (
          <span class="c-removed">Removed by a moderator</span>
        ) : (
          <>
            <VoteMark
              ctx={ctx}
              target={`/item/${itemId}#${anchor}`}
              label={`the comment by ${node.author.login}`}
              points={node.points}
              size="comment"
            />
            <a class="c-author" translate="no" href={`/u/${node.author.login}`}>
              {node.author.login}
            </a>{' '}
            <a class="c-time" href={`#${anchor}`}>
              <Time at={node.createdAt} now={ctx.now} />
            </a>{' '}
            <span class="c-points">{plural(node.points, 'point')}</span>
          </>
        )}{' '}
        <span class="c-folded">({plural(hidden, 'comment')} folded)</span>
      </div>
      <details class="c-fold" open>
        <summary
          class="c-toggle"
          aria-label={node.deleted ? 'Removed comment' : `Comment by ${node.author.login}`}
        />
        {!node.deleted && (
          <div class="c-body prose" dir="auto">
            {raw(node.bodyHtml)}
          </div>
        )}
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
