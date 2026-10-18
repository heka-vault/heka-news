// One item and its comments. A post gets the long-form reading view; a link its heading, domain
// and optional text; a status note its text, large.

import { raw } from 'hono/html'
import { RULES } from '../../config.ts'
import type { CommentNode, ItemDetail } from '../../db/types.ts'
import { isoTime, plural, readingMinutes } from '../../lib/format.ts'
import { itemJsonLd } from '../../lib/jsonld.ts'
import { excerpt, htmlToText, USER_LINK_REL } from '../../lib/markdown.ts'
import { LIMITS } from '../../lib/validate.ts'
import { CommentTree } from '../components/Comments.tsx'
import { Csrf, FormActions, MARKDOWN_HINT, Preview, TextArea } from '../components/Forms.tsx'
import { Tags, VoteMark } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import { Time } from '../components/Time.tsx'
import { canEdit, isMine, type PageContext } from '../context.ts'

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

/** What the author, a moderator and any member can do to an item, under its byline. */
function ItemActions({ ctx, item }: { ctx: PageContext; item: ItemDetail }) {
  const viewer = ctx.viewer
  if (!viewer) return null
  const mine = isMine(ctx, item.authorId)
  const links = [
    canEdit(ctx, item.authorId, item.createdAt, RULES.editWindow) && {
      href: `/item/${item.id}/edit`,
      label: 'edit',
    },
    mine && { href: `/item/${item.id}/delete`, label: 'delete' },
    !mine && { href: `/item/${item.id}/flag`, label: 'flag' },
    viewer.isModerator && { href: `/item/${item.id}/tags`, label: 'edit tags' },
    viewer.isModerator && { href: `/item/${item.id}/remove`, label: 'remove' },
  ].filter((link): link is { href: string; label: string } => Boolean(link))
  return (
    <p class="item-actions">
      {links.map((link) => (
        <a class="c-action" href={link.href} rel="nofollow">
          {link.label}
        </a>
      ))}
      {item.flagCount >= RULES.flagThreshold && viewer.isModerator && (
        <span class="item-actions__note">
          {plural(item.flagCount, 'open flag')}: off the front page until a moderator acts.{' '}
          <a href="/mod">Queue</a>
        </span>
      )}
    </p>
  )
}

/** The top-level comment form for members. */
export function CommentForm(props: {
  ctx: PageContext
  action: string
  parent?: number
  value?: string
  error?: string
  previewHtml?: string | null
  label?: string
  focus?: boolean
  inline?: boolean
}) {
  return (
    <form
      class={props.inline ? 'form comment-form reply-inline' : 'form comment-form'}
      method="post"
      action={props.action}
      data-preview="comment"
    >
      <Csrf ctx={props.ctx} />
      {props.parent !== undefined && (
        <input type="hidden" name="parent" value={String(props.parent)} />
      )}
      <TextArea
        name="body"
        label={props.label ?? 'Add a comment'}
        value={props.value ?? ''}
        error={props.error}
        rows={props.inline ? 4 : 5}
        limit={LIMITS.comment}
        required
        focus={props.focus}
        hint={props.inline ? undefined : MARKDOWN_HINT}
      />
      <Preview html={props.previewHtml} />
      <FormActions
        label={props.parent !== undefined ? 'Post reply' : 'Post comment'}
        sending="Posting…"
        preview
        extra={
          props.inline ? (
            <button class="form__cancel" type="button" data-cancel="">
              Cancel
            </button>
          ) : undefined
        }
      />
    </form>
  )
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
      scripts={ctx.viewer ? ['forms', 'reply'] : undefined}
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
              kind="item"
              id={item.id}
              authorId={item.authorId}
              target={href}
              label={item.title ?? 'this status note'}
              points={item.points}
            />
            <p class="meta">
              <a class="meta__author" translate="no" href={`/u/${item.author.login}`}>
                {item.author.login}
              </a>{' '}
              <Time at={item.createdAt} now={ctx.now} />
              {isPost && <span> {readingMinutes(item.bodyChars)} min read</span>}
              {item.editedAt && <span> edited</span>} <Tags tags={item.tags} />
            </p>
          </div>
          <ItemActions ctx={ctx} item={item} />
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
          <h2 id="comments" class="discussion__title" data-count={item.commentCount}>
            {item.commentCount === 0 ? 'No comments yet' : plural(item.commentCount, 'comment')}
          </h2>
          {ctx.viewer ? (
            <CommentForm ctx={ctx} action={`${href}/comments`} />
          ) : (
            <p class="discussion__note">
              Members can comment and vote. <a href="/about#membership">How membership works</a>
            </p>
          )}
          {comments.length > 0 && <CommentTree nodes={comments} ctx={ctx} itemId={item.id} />}
        </div>
        {ctx.viewer && (
          <template id="reply-template">
            <CommentForm
              ctx={ctx}
              action={`${href}/comments`}
              parent={0}
              label="Your reply"
              inline
            />
          </template>
        )}
      </section>
    </Layout>
  )
}
