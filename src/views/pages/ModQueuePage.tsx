// /mod: the moderators' queue. Flagged items and comments, most flagged first, each with one
// reason field and two buttons (remove, or keep and close the flags); recent removals that can be
// undone; open invitations; and new tags. Every action here writes the public log.

import { raw } from 'hono/html'
import type { FlaggedComment, FlaggedItem, InviteRow, Removal, Tag } from '../../db/types.ts'
import { longDate, plural } from '../../lib/format.ts'
import { type Errors, FLAG_REASONS, LIMITS } from '../../lib/validate.ts'
import { Csrf, ErrorSummary, TextField } from '../components/Forms.tsx'
import { Empty, ItemList } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import { Time } from '../components/Time.tsx'
import type { PageContext } from '../context.ts'

function reasonsLine(reasons: Partial<Record<string, number>>): string {
  return Object.entries(reasons)
    .map(([reason, n]) => {
      const label = FLAG_REASONS.find((r) => r.value === reason)?.label.toLowerCase() ?? reason
      return `${label} ${n}`
    })
    .join(', ')
}

/** One reason field, two outcomes. */
function Decide(props: { ctx: PageContext; id: string; remove: string; keep: string }) {
  return (
    <form class="decide" method="post" action={props.remove}>
      <Csrf ctx={props.ctx} />
      <label class="sr-only" for={`reason-${props.id}`}>
        Reason, published in the moderation log
      </label>
      <input
        class="input input--small"
        id={`reason-${props.id}`}
        name="reason"
        maxlength={LIMITS.reason}
        required
        placeholder="Reason, for the public log…"
        autocomplete="off"
      />
      <button class="button button--small button--danger" type="submit">
        Remove
      </button>
      <button class="button button--small button--quiet" type="submit" formaction={props.keep}>
        Keep
      </button>
    </form>
  )
}

export function ModQueuePage(props: {
  ctx: PageContext
  items: FlaggedItem[]
  comments: FlaggedComment[]
  removals: Removal[]
  invites: InviteRow[]
  tags: Tag[]
  tagForm: { name: string; description: string; reason: string; errors: Errors }
}) {
  const { ctx } = props
  const flagged = props.items.length + props.comments.length
  return (
    <Layout
      ctx={ctx}
      title="Moderation queue"
      description="Flags waiting for a moderator."
      nav="mod"
      noindex
    >
      <div class="wrap modq">
        <header class="page-head">
          <h1>Moderation queue</h1>
          <p>
            {flagged === 0
              ? 'Nothing is waiting. Every action you take here is published in the '
              : `${plural(flagged, 'thing')} flagged. Every action you take here is published in the `}
            <a href="/moderation">moderation log</a> with your reason.
          </p>
        </header>

        <section aria-labelledby="flagged-items">
          <h2 id="flagged-items" class="section-title">
            Flagged items
          </h2>
          {props.items.length === 0 ? (
            <p class="muted">No item has an open flag.</p>
          ) : (
            <ul class="modq__list">
              {props.items.map((entry) => (
                <li class="modq__entry">
                  <ItemList items={[entry.item]} ctx={ctx} />
                  <p class="modq__flags">
                    {plural(entry.total, 'flag')}: {reasonsLine(entry.reasons)}. Latest{' '}
                    <Time at={entry.latestAt} now={ctx.now} />.
                  </p>
                  <Decide
                    ctx={ctx}
                    id={`i${entry.item.id}`}
                    remove={`/item/${entry.item.id}/remove`}
                    keep={`/item/${entry.item.id}/keep`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="flagged-comments">
          <h2 id="flagged-comments" class="section-title">
            Flagged comments
          </h2>
          {props.comments.length === 0 ? (
            <p class="muted">No comment has an open flag.</p>
          ) : (
            <ul class="modq__list">
              {props.comments.map((entry) => (
                <li class="modq__entry">
                  <p class="listing__head">
                    <a class="c-author" href={`/u/${entry.comment.author.login}`} translate="no">
                      {entry.comment.author.login}
                    </a>{' '}
                    on{' '}
                    <a href={`/item/${entry.comment.itemId}#c${entry.comment.id}`} dir="auto">
                      {entry.comment.itemTitle}
                    </a>
                  </p>
                  <div class="listing__body prose" dir="auto">
                    {raw(entry.comment.bodyHtml)}
                  </div>
                  <p class="modq__flags">
                    {plural(entry.total, 'flag')}: {reasonsLine(entry.reasons)}. Latest{' '}
                    <Time at={entry.latestAt} now={ctx.now} />.
                  </p>
                  <Decide
                    ctx={ctx}
                    id={`c${entry.comment.id}`}
                    remove={`/c/${entry.comment.id}/remove`}
                    keep={`/c/${entry.comment.id}/keep`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="removals">
          <h2 id="removals" class="section-title">
            Recently removed
          </h2>
          {props.removals.length === 0 ? (
            <p class="muted">Nothing has been removed.</p>
          ) : (
            <ul class="modq__list">
              {props.removals.map((removal) => (
                <li class="modq__entry modq__entry--compact">
                  <p class="listing__head">
                    {removal.kind === 'item' ? 'Item' : 'Comment'} by{' '}
                    <a href={`/u/${removal.author}`} translate="no">
                      {removal.author}
                    </a>
                    , removed <Time at={removal.removedAt} now={ctx.now} />:{' '}
                    <a
                      href={
                        removal.kind === 'item'
                          ? `/item/${removal.itemId}`
                          : `/item/${removal.itemId}#c${removal.id}`
                      }
                      dir="auto"
                    >
                      {removal.label}
                    </a>
                  </p>
                  <form
                    class="decide"
                    method="post"
                    action={
                      removal.kind === 'item'
                        ? `/item/${removal.id}/restore`
                        : `/c/${removal.id}/restore`
                    }
                  >
                    <Csrf ctx={ctx} />
                    <label class="sr-only" for={`restore-${removal.kind}-${removal.id}`}>
                      Reason for restoring, published in the moderation log
                    </label>
                    <input
                      class="input input--small"
                      id={`restore-${removal.kind}-${removal.id}`}
                      name="reason"
                      maxlength={LIMITS.reason}
                      required
                      placeholder="Reason, for the public log…"
                      autocomplete="off"
                    />
                    <button class="button button--small button--quiet" type="submit">
                      Restore
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="open-invites">
          <h2 id="open-invites" class="section-title">
            Open invitations
          </h2>
          {props.invites.length === 0 ? (
            <p class="muted">No invitation is waiting to be used.</p>
          ) : (
            <ul class="modq__list">
              {props.invites.map((invite) => (
                <li class="modq__entry modq__entry--compact">
                  <p class="listing__head">
                    From{' '}
                    <a href={`/u/${invite.inviter.login}`} translate="no">
                      {invite.inviter.login}
                    </a>
                    , made {longDate(invite.createdAt)}, works until {longDate(invite.expiresAt)}
                  </p>
                  <form class="decide" method="post" action={`/mod/invites/${invite.id}/revoke`}>
                    <Csrf ctx={ctx} />
                    <label class="sr-only" for={`revoke-${invite.id}`}>
                      Reason for revoking, published in the moderation log
                    </label>
                    <input
                      class="input input--small"
                      id={`revoke-${invite.id}`}
                      name="reason"
                      maxlength={LIMITS.reason}
                      required
                      placeholder="Reason, for the public log…"
                      autocomplete="off"
                    />
                    <button class="button button--small button--quiet" type="submit">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tags">
          <h2 id="tags" class="section-title">
            Tags
          </h2>
          {props.tags.length > 0 ? (
            <p class="section-intro">
              {props.tags.map((tag, i) => (
                <>
                  {i > 0 && ', '}
                  <a href={`/t/${tag.name}`}>{tag.name}</a>
                </>
              ))}
              .
            </p>
          ) : (
            <Empty title="No tags yet.">
              <p>Members need at least one tag to post anything. Add the first one below.</p>
            </Empty>
          )}
          <form class="form" method="post" action="/mod/tags" novalidate>
            <Csrf ctx={ctx} />
            <ErrorSummary
              errors={props.tagForm.errors}
              labels={{ name: 'Name', description: 'Description', reason: 'Reason' }}
            />
            <TextField
              name="name"
              label="New tag"
              hint="Lowercase letters and digits, up to 24."
              value={props.tagForm.name}
              error={props.tagForm.errors.name}
              maxLength={24}
              spellcheck={false}
              focus={Boolean(props.tagForm.errors.name)}
            />
            <TextField
              name="description"
              label="Description"
              hint="One sentence; shown on the tag’s page and the about page."
              value={props.tagForm.description}
              error={props.tagForm.errors.description}
              limit={LIMITS.tagDescription}
            />
            <TextField
              name="reason"
              label="Reason"
              hint="Published in the moderation log."
              value={props.tagForm.reason}
              error={props.tagForm.errors.reason}
              limit={LIMITS.reason}
            />
            <div class="form__actions">
              <button class="button" type="submit">
                Add tag
              </button>
            </div>
          </form>
        </section>
      </div>
    </Layout>
  )
}
