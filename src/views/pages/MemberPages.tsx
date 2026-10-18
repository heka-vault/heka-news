// Pages for members' actions on a single thing: replying without JavaScript, editing a comment,
// confirming a delete or a removal, flagging, and the list of replies to you.

import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import type { CommentDetail, CommentListing, ItemDetail } from '../../db/types.ts'
import { plural } from '../../lib/format.ts'
import { type Errors, FLAG_REASONS, LIMITS } from '../../lib/validate.ts'
import {
  Csrf,
  ErrorSummary,
  FormActions,
  MARKDOWN_HINT,
  Preview,
  TextArea,
  TextField,
} from '../components/Forms.tsx'
import { Empty, itemLabel, Pager } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import { Time } from '../components/Time.tsx'
import type { PageContext } from '../context.ts'
import { CommentForm } from './ItemPage.tsx'

/** A comment quoted at the top of a page: who, when, what. */
export function QuotedComment({ ctx, comment }: { ctx: PageContext; comment: CommentDetail }) {
  return (
    <figure class="quoted">
      <figcaption class="quoted__head">
        <a class="c-author" href={`/u/${comment.author.login}`} translate="no">
          {comment.author.login}
        </a>{' '}
        <a href={`/item/${comment.itemId}#c${comment.id}`}>
          <Time at={comment.createdAt} now={ctx.now} />
        </a>{' '}
        on{' '}
        <a href={`/item/${comment.itemId}`} dir="auto">
          {comment.itemTitle}
        </a>
      </figcaption>
      <div class="quoted__body prose" dir="auto">
        {comment.deleted ? <p class="muted">[deleted]</p> : raw(comment.bodyHtml)}
      </div>
    </figure>
  )
}

export function ReplyPage(props: {
  ctx: PageContext
  parent: CommentDetail
  value: string
  error?: string
  previewHtml?: string | null
}) {
  const { ctx, parent } = props
  return (
    <Layout ctx={ctx} title="Reply" description="Reply to a comment." noindex scripts={['forms']}>
      <div class="wrap">
        <header class="page-head">
          <h1>Reply to {parent.author.login}</h1>
        </header>
        <QuotedComment ctx={ctx} comment={parent} />
        <CommentForm
          ctx={ctx}
          action={`/item/${parent.itemId}/comments`}
          parent={parent.id}
          label="Your reply"
          value={props.value}
          error={props.error}
          previewHtml={props.previewHtml}
          focus
        />
      </div>
    </Layout>
  )
}

/** A top-level comment that came back: too long, or previewed without JavaScript. */
export function CommentPage(props: {
  ctx: PageContext
  item: ItemDetail
  value: string
  error?: string
  previewHtml?: string
}) {
  const { ctx, item } = props
  return (
    <Layout ctx={ctx} title="Comment" description="Comment on an item." noindex scripts={['forms']}>
      <div class="wrap">
        <header class="page-head">
          <h1>Comment</h1>
          <p>
            On{' '}
            <a href={`/item/${item.id}`} dir="auto">
              {itemLabel(item)}
            </a>
          </p>
        </header>
        <CommentForm
          ctx={ctx}
          action={`/item/${item.id}/comments`}
          value={props.value}
          error={props.error}
          previewHtml={props.previewHtml}
          focus={Boolean(props.error)}
        />
      </div>
    </Layout>
  )
}

export function EditCommentPage(props: {
  ctx: PageContext
  comment: CommentDetail
  value: string
  error?: string
  previewHtml?: string | null
  minutesLeft: number
}) {
  const { ctx, comment } = props
  return (
    <Layout
      ctx={ctx}
      title="Edit comment"
      description="Edit a comment."
      noindex
      scripts={['forms']}
    >
      <div class="wrap">
        <header class="page-head">
          <h1>Edit your comment</h1>
          <p>
            You can edit for {plural(props.minutesLeft, 'more minute', 'more minutes')}. The comment
            will say it was edited.
          </p>
        </header>
        <form
          class="form comment-form"
          method="post"
          action={`/c/${comment.id}/edit`}
          data-preview="comment"
        >
          <Csrf ctx={ctx} />
          <TextArea
            name="body"
            label="Comment"
            value={props.value}
            error={props.error}
            rows={8}
            limit={LIMITS.comment}
            hint={MARKDOWN_HINT}
            required
            focus={Boolean(props.error)}
          />
          <Preview html={props.previewHtml} />
          <FormActions
            label="Save changes"
            sending="Saving…"
            preview
            cancel={{ href: `/item/${comment.itemId}#c${comment.id}`, label: 'Cancel' }}
          />
        </form>
      </div>
    </Layout>
  )
}

/**
 * "Are you sure?" for deleting your own work, and the reason form for every moderator action.
 * A reason is required whenever the action is published in the moderation log.
 */
export function ConfirmPage(props: {
  ctx: PageContext
  title: string
  children: Child
  action: string
  button: string
  sending: string
  cancel: string
  reason?: { value: string; error?: string; label?: string; hint?: string }
  /** Extra fields before the reason (tags, for re-tagging). */
  fields?: Child
  errors?: Errors
  danger?: boolean
}) {
  const { ctx, reason } = props
  return (
    <Layout ctx={ctx} title={props.title} description={props.title} noindex scripts={['forms']}>
      <div class="wrap">
        <header class="page-head">
          <h1>{props.title}</h1>
        </header>
        <div class="confirm">{props.children}</div>
        <form class="form confirm__form" method="post" action={props.action} novalidate>
          <Csrf ctx={ctx} />
          {props.errors && (
            <ErrorSummary errors={props.errors} labels={{ reason: 'Reason', tags: 'Tags' }} />
          )}
          {props.fields}
          {reason && (
            <TextField
              name="reason"
              label={reason.label ?? 'Reason'}
              hint={reason.hint ?? 'Published in the moderation log with your login.'}
              value={reason.value}
              error={reason.error}
              limit={LIMITS.reason}
              required
              focus={Boolean(reason.error)}
            />
          )}
          <div class="form__actions">
            <button
              class={props.danger ? 'button button--danger' : 'button'}
              type="submit"
              data-sending={props.sending}
            >
              {props.button}
            </button>
            <a class="form__cancel" href={props.cancel}>
              Cancel
            </a>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function FlagPage(props: {
  ctx: PageContext
  what: 'item' | 'comment'
  label: string
  href: string
  action: string
  existing: { reason: string; resolved: boolean } | null
  error?: string
}) {
  const { ctx, existing } = props
  const reasonLabel = FLAG_REASONS.find((r) => r.value === existing?.reason)?.label.toLowerCase()
  return (
    <Layout ctx={ctx} title="Flag" description="Flag something for the moderators." noindex>
      <div class="wrap">
        <header class="page-head">
          <h1>Flag this {props.what}</h1>
          <p>
            <a href={props.href} dir="auto">
              {props.label}
            </a>
          </p>
        </header>
        {existing ? (
          <div class="prose reading">
            <p>
              You flagged it as {reasonLabel ?? existing.reason}.{' '}
              {existing.resolved
                ? 'A moderator has looked at it since, so the flag is closed.'
                : 'The moderators will see it in their queue.'}
            </p>
            {!existing.resolved && (
              <form method="post" action={props.action}>
                <Csrf ctx={ctx} />
                <input type="hidden" name="intent" value="withdraw" />
                <button class="button button--quiet" type="submit">
                  Withdraw my flag
                </button>
              </form>
            )}
            <p>
              <a href={props.href}>Back</a>
            </p>
          </div>
        ) : (
          <form class="form" method="post" action={props.action} novalidate>
            <Csrf ctx={ctx} />
            <fieldset
              class={props.error ? 'field field--invalid' : 'field'}
              id="f-reason"
              aria-describedby={props.error ? 'f-reason-hint f-reason-error' : 'f-reason-hint'}
            >
              <legend class="field__label">What is wrong with it?</legend>
              <p class="field__hint" id="f-reason-hint">
                Moderators see who flagged what. When three members flag an item, it leaves the
                front page until a moderator looks.
              </p>
              <div class="choices">
                {FLAG_REASONS.map((reason, i) => (
                  <label class="choice">
                    <input
                      type="radio"
                      name="reason"
                      value={reason.value}
                      required
                      autofocus={Boolean(props.error) && i === 0}
                    />
                    <span class="choice__text">
                      <span class="choice__label">{reason.label}</span>
                      <span class="choice__hint">{reason.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {props.error && (
                <p class="field__error" id="f-reason-error">
                  {props.error}
                </p>
              )}
            </fieldset>
            <div class="form__actions">
              <button class="button" type="submit" data-sending="Flagging…">
                Flag it
              </button>
              <a class="form__cancel" href={props.href}>
                Cancel
              </a>
            </div>
          </form>
        )}
      </div>
    </Layout>
  )
}

/** A comment away from its thread, with the item it is on. */
export function CommentListingRow({ ctx, comment }: { ctx: PageContext; comment: CommentListing }) {
  return (
    <li class="listing">
      <p class="listing__head">
        <a class="c-author" href={`/u/${comment.author.login}`} translate="no">
          {comment.author.login}
        </a>{' '}
        <a href={`/item/${comment.itemId}#c${comment.id}`}>
          <Time at={comment.createdAt} now={ctx.now} />
        </a>{' '}
        {comment.inReplyTo === 'comment' ? 'replied on' : 'commented on'}{' '}
        <a href={`/item/${comment.itemId}`} dir="auto">
          {comment.itemTitle}
        </a>
      </p>
      <div class="listing__body prose" dir="auto">
        {raw(comment.bodyHtml)}
      </div>
    </li>
  )
}

export function RepliesPage(props: {
  ctx: PageContext
  replies: CommentListing[]
  page: number
  hasNext: boolean
}) {
  const { ctx, page } = props
  return (
    <Layout
      ctx={ctx}
      title="Replies"
      description="Replies to your items and comments."
      nav="replies"
      noindex
    >
      <div class="wrap">
        <header class="page-head">
          <h1>{page > 1 ? `Replies, page ${page}` : 'Replies'}</h1>
          <p>Comments on your items and replies to your comments, newest first.</p>
        </header>
        {props.replies.length > 0 ? (
          <ol class="listings">
            {props.replies.map((reply) => (
              <CommentListingRow ctx={ctx} comment={reply} />
            ))}
          </ol>
        ) : (
          <Empty title="No replies yet.">
            <p>
              When someone comments on an item of yours or replies to a comment, it shows up here.
            </p>
          </Empty>
        )}
        <Pager
          prev={
            page > 1
              ? { href: page === 2 ? '/replies' : `/replies?p=${page - 1}`, label: 'Newer replies' }
              : undefined
          }
          next={
            props.hasNext ? { href: `/replies?p=${page + 1}`, label: 'Older replies' } : undefined
          }
        />
      </div>
    </Layout>
  )
}
