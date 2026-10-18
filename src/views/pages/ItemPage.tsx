// One item and its comments. A post gets the long-form reading view; a link its heading, domain
// and optional text; a status note its text, large.

import { raw } from 'hono/html'
import type { CommentNode, ItemDetail } from '../../db/types.ts'
import { isoTime, plural, readingMinutes } from '../../lib/format.ts'
import { itemJsonLd } from '../../lib/jsonld.ts'
import { excerpt, htmlToText, USER_LINK_REL } from '../../lib/markdown.ts'
import { CommentTree } from '../components/Comments.tsx'
import { Tags, VoteMark } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import { Time } from '../components/Time.tsx'
import type { PageContext } from '../context.ts'

export function itemTitle(item: ItemDetail): string {
  if (item.title) return item.title
  return `${item.author.login}: ${excerpt(htmlToText(item.bodyHtml), 70)}`
}

function itemDescription(item: ItemDetail): string {
  const text = item.bodyHtml ? htmlToText(item.bodyHtml) : ''
  if (item.kind === 'link') {
    const counts = `${plural(item.points, 'point')} and ${plural(item.commentCount, 'comment')}`
    return excerpt(
      text
        ? `${text} (${item.domain}, ${counts})`
        : `A link to ${item.domain}, shared by ${item.author.login}: ${counts}.`,
    )
  }
  return excerpt(text)
}

export function ItemPage(props: { ctx: PageContext; item: ItemDetail; comments: CommentNode[] }) {
  const { ctx, item, comments } = props
  const href = `/item/${item.id}`
  const isPost = item.kind === 'post'

  return (
    <Layout
      ctx={ctx}
      title={itemTitle(item)}
      description={itemDescription(item)}
      canonical={href}
      ogType="article"
      publishedTime={isoTime(item.createdAt)}
      modifiedTime={item.editedAt ? isoTime(item.editedAt) : undefined}
      author={`${ctx.config.publicUrl}/u/${item.author.login}`}
      tags={item.tags}
      jsonLd={[itemJsonLd(ctx.config.publicUrl, item, comments)]}
    >
      <article class={`item-page item-page--${item.kind}`}>
        <header class="wrap item-head">
          {item.kind === 'status' ? (
            <h1 class="sr-only">Status note by {item.author.login}</h1>
          ) : (
            <h1 class="item-head__title" dir="auto" style={`view-transition-name: item-${item.id}`}>
              {item.title}
            </h1>
          )}
          {item.kind === 'link' && item.url && (
            <p class="item-head__link">
              <a href={item.url} rel={USER_LINK_REL}>
                {item.domain}
              </a>
            </p>
          )}
          {item.kind === 'status' && (
            <div class="note note--page" dir="auto">
              {raw(item.bodyHtml)}
            </div>
          )}
          <div class="byline">
            <VoteMark
              ctx={ctx}
              target={href}
              label={item.title ?? 'this status note'}
              points={item.points}
            />
            <p class="meta">
              <a class="meta__author" translate="no" href={`/u/${item.author.login}`}>
                {item.author.login}
              </a>{' '}
              <Time at={item.createdAt} now={ctx.now} />
              {isPost && <span> {readingMinutes(item.bodyChars)} min read</span>}{' '}
              <Tags tags={item.tags} />
            </p>
          </div>
        </header>
        {item.kind !== 'status' && item.bodyHtml && (
          <div class="wrap">
            <div class={isPost ? 'prose reading' : 'prose item-text'} dir="auto">
              {raw(item.bodyHtml)}
            </div>
          </div>
        )}
      </article>
      <section class="discussion" aria-labelledby="comments">
        <div class="wrap">
          <h2 id="comments" class="discussion__title">
            {item.commentCount === 0 ? 'No comments yet' : plural(item.commentCount, 'comment')}
          </h2>
          <p class="discussion__note">
            Members can comment and vote. <a href="/about#membership">How membership works</a>
          </p>
          {comments.length > 0 && <CommentTree nodes={comments} ctx={ctx} itemId={item.id} />}
        </div>
      </section>
    </Layout>
  )
}
