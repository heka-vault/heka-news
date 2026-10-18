// A member's profile and their items.

import type { ItemSummary, UserProfile } from '../../db/types.ts'
import { longDate, plural } from '../../lib/format.ts'
import { profileJsonLd } from '../../lib/jsonld.ts'
import { excerpt } from '../../lib/markdown.ts'
import { Empty, ItemList, Pager } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

export function UserPage(props: {
  ctx: PageContext
  user: UserProfile
  items: ItemSummary[]
  page: number
  hasNext: boolean
}) {
  const { ctx, user, items, page } = props
  const base = `/u/${user.login}`
  const canonical = page > 1 ? `${base}?p=${page}` : base
  const description = user.bio
    ? excerpt(`${user.login} on heka news: ${user.bio}`)
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
          {user.bio && (
            <p class="profile__bio" dir="auto">
              {user.bio}
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
      </div>
    </Layout>
  )
}
