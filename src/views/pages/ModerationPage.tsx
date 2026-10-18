// The public moderation log: every moderator action with its reason.

import type { ModLogEntry } from '../../db/types.ts'
import { isoTime, longDate } from '../../lib/format.ts'
import { Empty, Pager } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

const ACTIONS: Record<string, string> = {
  delete_item: 'Removed an item',
  restore_item: 'Restored an item',
  edit_item: 'Edited an item',
  retag_item: 'Changed tags',
  delete_comment: 'Removed a comment',
  restore_comment: 'Restored a comment',
  ban_user: 'Banned a member',
  unban_user: 'Lifted a ban',
  revoke_invite: 'Revoked an invitation',
}

function Subject({ entry }: { entry: ModLogEntry }) {
  if (entry.commentId && entry.itemId) {
    return <a href={`/item/${entry.itemId}#c${entry.commentId}`}>{entry.subject || 'A comment'}</a>
  }
  if (entry.itemId) {
    return (
      <a href={`/item/${entry.itemId}`} dir="auto">
        {entry.subject || `Item ${entry.itemId}`}
      </a>
    )
  }
  if (entry.subjectUser) return <a href={`/u/${entry.subjectUser}`}>{entry.subjectUser}</a>
  return <span dir="auto">{entry.subject}</span>
}

export function ModerationPage(props: {
  ctx: PageContext
  entries: ModLogEntry[]
  page: number
  hasNext: boolean
}) {
  const { ctx, entries, page } = props
  return (
    <Layout
      ctx={ctx}
      title={page > 1 ? `Moderation log, page ${page}` : 'Moderation log'}
      description="Every action a heka news moderator has taken, with the reason, newest first."
      canonical={page > 1 ? `/moderation?p=${page}` : '/moderation'}
    >
      <div class="wrap">
        <header class="page-head">
          <h1>Moderation log</h1>
          <p>Every action a moderator takes is listed here with the reason, newest first.</p>
        </header>
        {entries.length > 0 ? (
          <table class="modlog">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Moderator</th>
                <th scope="col">Action</th>
                <th scope="col">Subject</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr>
                  <td data-label="Date">
                    <time datetime={isoTime(entry.createdAt)}>{longDate(entry.createdAt)}</time>
                  </td>
                  <td data-label="Moderator">
                    <a href={`/u/${entry.moderator}`}>{entry.moderator}</a>
                  </td>
                  <td data-label="Action">{ACTIONS[entry.action] ?? entry.action}</td>
                  <td data-label="Subject" class="modlog__subject">
                    <Subject entry={entry} />
                  </td>
                  <td data-label="Reason" dir="auto">
                    {entry.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No moderator has acted yet.">
            <p>When one does, the action and the reason appear here.</p>
          </Empty>
        )}
        <Pager
          prev={
            page > 1
              ? {
                  href: page === 2 ? '/moderation' : `/moderation?p=${page - 1}`,
                  label: 'Newer entries',
                }
              : undefined
          }
          next={
            props.hasNext
              ? { href: `/moderation?p=${page + 1}`, label: 'Older entries' }
              : undefined
          }
        />
      </div>
    </Layout>
  )
}
