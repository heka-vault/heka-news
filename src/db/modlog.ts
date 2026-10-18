// Reading the public moderation log. All mod_log SQL for reads lives here.

import type { Db } from './index.ts'
import type { ModLogEntry } from './types.ts'

/** The log, newest first. */
export function listModLog(db: Db, opts: { limit: number; offset: number }): ModLogEntry[] {
  return db
    .query<
      {
        id: number
        created_at: number
        moderator: string
        action: string
        item_id: number | null
        comment_id: number | null
        subject_user: string | null
        subject: string
        reason: string
      },
      [number, number]
    >(
      `SELECT m.id, m.created_at, mu.login AS moderator, m.action, m.item_id, m.comment_id,
              su.login AS subject_user, m.subject, m.reason
       FROM mod_log m
       JOIN users mu ON mu.id = m.moderator_id
       LEFT JOIN users su ON su.id = m.subject_user_id
       ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    )
    .all(opts.limit, opts.offset)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      moderator: row.moderator,
      action: row.action,
      itemId: row.item_id,
      commentId: row.comment_id,
      subjectUser: row.subject_user,
      subject: row.subject,
      reason: row.reason,
    }))
}

/** Number of log entries. */
export function countModLog(db: Db): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM mod_log').get()?.n ?? 0
}
