// A member's profile and their items.

import { raw } from 'hono/html'
import type { CommentListing, ItemSummary, UserProfile } from '../../db/types.ts'
import { longDate, plural } from '../../lib/format.ts'
import { profileJsonLd } from '../../lib/jsonld.ts'
import { excerpt, htmlToText } from '../../lib/markdown.ts'
import { LIMITS } from '../../lib/validate.ts'
import { Csrf } from '../components/Forms.tsx'
import { Empty, ItemList, Pager } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'
import { CommentListingRow } from './MemberPages.tsx'

/** A moderator's ban or unban, with the reason that goes in the log. */
function BanForm({ ctx, user }: { ctx: PageContext; user: UserProfile }) {
  const action = user.banned ? 'unban' : 'ban'
  return (
    <form class="decide decide--profile" method="post" action={`/u/${user.login}/${action}`}>
      <Csrf ctx={ctx} />
      <label class="field__label" for="ban-reason">
        {user.banned ? 'Lift the ban' : 'Ban this member'}
      </label>
      <p class="field__hint" id="ban-reason-hint">
        {user.banned
          ? 'They can sign in again. The reason is published in the moderation log.'
          : 'Signs them out everywhere and withdraws their open invitations. The reason is published in the moderation log.'}
      </p>
      <div class="decide__row">
        <input
          class="input input--small"
          id="ban-reason"
          name="reason"
          maxlength={LIMITS.reason}
          required
          autocomplete="off"
          aria-describedby="ban-reason-hint"
          placeholder="Reason, for the public log…"
        />
        <button
          class={user.banned ? 'button button--small' : 'button button--small button--danger'}
          type="submit"
        >
          {user.banned ? 'Lift ban' : 'Ban'}
        </button>
      </div>
    </form>
  )
}

export function UserPage(props: {
  ctx: PageContext
  user: UserProfile
  items: ItemSummary[]
  comments: CommentListing[]
  page: number
  hasNext: boolean
}) {
  const { ctx, user, items, page } = props
  const self = ctx.viewer?.id === user.id
  const base = `/u/${user.login}`
  const canonical = page > 1 ? `${base}?p=${page}` : base
  const description = user.bioHtml
    ? excerpt(`${user.login} on heka news: ${htmlToText(user.bioHtml)}`)
    : `${user.login} on heka news: ${plural(user.itemCount, 'item')} and ${plural(user.commentCount, 'comment')}.`

  return (
    <Layout
      ctx={ctx}
      title={page > 1 ? `${user.login}, page ${page}` : user.login}
      description={description}
      canonical={canonical}
      ogType="website"
      jsonLd={[profileJsonLd(ctx.config.publicUrl, user)]}
    >
      <div class="wrap">
        <header class="profile">
          <h1 class="profile__login" translate="no">
            {user.login}
          </h1>
          {user.displayName && (
            <p class="profile__name" dir="auto">
              {user.displayName}
            </p>
          )}
          {(user.isModerator || user.banned) && (
            <p class="profile__roles">
              {user.isModerator && <span class="role">Moderator</span>}
              {user.banned && <span class="role role--banned">Banned</span>}
            </p>
          )}
          {user.bioHtml && (
            <div class="profile__bio prose" dir="auto">
              {raw(user.bioHtml)}
            </div>
          )}
          {self && (
            <p class="profile__own">
              <a href="/settings">Edit your profile and invite someone</a>
            </p>
          )}
          <dl class="facts">
            <div>
              <dt>Joined</dt>
              <dd>{longDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Invited by</dt>
              <dd>
                {user.invitedBy ? (
                  <a href={`/u/${user.invitedBy.login}`}>{user.invitedBy.login}</a>
                ) : (
                  'Founding member'
                )}
              </dd>
            </div>
            <div>
              <dt>Invited</dt>
              <dd>
                {user.invited.length === 0
                  ? 'Nobody yet'
                  : user.invited.map((u, i) => (
                      <>
                        {i > 0 && ', '}
                        <a href={`/u/${u.login}`}>{u.login}</a>
                      </>
                    ))}
              </dd>
            </div>
            <div>
              <dt>Wrote</dt>
              <dd>
                {plural(user.itemCount, 'item')}, {plural(user.commentCount, 'comment')}
              </dd>
            </div>
          </dl>
          {ctx.viewer?.isModerator && !self && !user.isModerator && (
            <BanForm ctx={ctx} user={user} />
          )}
        </header>
        <section aria-labelledby="items-heading">
          <h2 id="items-heading" class="section-title">
            {page > 1 ? `Items, page ${page}` : 'Items'}
          </h2>
          {items.length > 0 ? (
            <ItemList items={items} ctx={ctx} />
          ) : (
            <Empty title={`${user.login} has not posted anything yet.`} />
          )}
          <Pager
            prev={
              page > 1
                ? { href: page === 2 ? base : `${base}?p=${page - 1}`, label: 'Newer items' }
                : undefined
            }
            next={
              props.hasNext ? { href: `${base}?p=${page + 1}`, label: 'Older items' } : undefined
            }
          />
        </section>
        {page === 1 && (
          <section aria-labelledby="comments-heading">
            <h2 id="comments-heading" class="section-title">
              Recent comments
            </h2>
            {props.comments.length > 0 ? (
              <ol class="listings">
                {props.comments.map((comment) => (
                  <CommentListingRow ctx={ctx} comment={comment} />
                ))}
              </ol>
            ) : (
              <Empty title={`${user.login} has not commented yet.`} />
            )}
          </section>
        )}
      </div>
    </Layout>
  )
}
