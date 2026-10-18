// Flags (ADR 0007): a member marks an item or comment as spam, off-topic or unkind. Open flags are
// counted in flag_count on the row; at RULES.flagThreshold an item leaves the front page until a
// moderator removes it or keeps it (src/db/moderation.ts), which resolves its flags.

import { commentListings } from './comments.ts'
import type { Db } from './index.ts'
import { itemSummaries } from './items.ts'
import type { FlaggedComment, FlaggedItem, FlagReason, FlagSummary } from './types.ts'

type Target = 'item' | 'comment'

const TABLE: Record<Target, { table: string; column: string }> = {
  item: { table: 'items', column: 'item_id' },
  comment: { table: 'comments', column: 'comment_id' },
}

export type FlagResult = { ok: true } | { ok: false; reason: 'missing' | 'own' | 'already' }

export function addFlag(
  db: Db,
  target: Target,
  id: number,
  userId: number,
  reason: FlagReason,
  now: number,
): FlagResult {
  const t = TABLE[target]
  return db.transaction((): FlagResult => {
    const row = db
      .query<{ author_id: number }, [number]>(
        `SELECT author_id FROM ${t.table} WHERE id = ? AND deleted = 0`,
      )
      .get(id)
    if (!row) return { ok: false, reason: 'missing' }
    if (row.author_id === userId) return { ok: false, reason: 'own' }
    const inserted = db
      .query(
        `INSERT INTO flags (user_id, ${t.column}, reason, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(userId, id, reason, now).changes
    if (inserted === 0) return { ok: false, reason: 'already' }
    db.query(`UPDATE ${t.table} SET flag_count = flag_count + 1 WHERE id = ?`).run(id)
    return { ok: true }
  })()
}

/** Withdraw a member's open flag. False if there was none, or a moderator already resolved it. */
export function withdrawFlag(db: Db, target: Target, id: number, userId: number): boolean {
  const t = TABLE[target]
  return db.transaction(() => {
    const removed = db
      .query(`DELETE FROM flags WHERE user_id = ? AND ${t.column} = ? AND resolved_at IS NULL`)
      .run(userId, id).changes
    if (removed === 1) {
      db.query(`UPDATE ${t.table} SET flag_count = max(flag_count - 1, 0) WHERE id = ?`).run(id)
    }
    return removed === 1
  })()
}

/** The member's flag on a target, if any, and whether a moderator has resolved it. */
export function memberFlag(
  db: Db,
  target: Target,
  id: number,
  userId: number,
): { reason: string; resolved: boolean } | null {
  const t = TABLE[target]
  const row = db
    .query<{ reason: string; resolved_at: number | null }, [number, number]>(
      `SELECT reason, resolved_at FROM flags WHERE user_id = ? AND ${t.column} = ?`,
    )
    .get(userId, id)
  return row ? { reason: row.reason, resolved: row.resolved_at !== null } : null
}

/** Mark a target's open flags resolved and zero its count. Used by moderator actions. */
export function resolveFlags(db: Db, target: Target, id: number, now: number): number {
  const t = TABLE[target]
  const resolved = db
    .query(`UPDATE flags SET resolved_at = ? WHERE ${t.column} = ? AND resolved_at IS NULL`)
    .run(now, id).changes
  db.query(`UPDATE ${t.table} SET flag_count = 0 WHERE id = ?`).run(id)
  return resolved
}

interface OpenRow {
  target_id: number
  reason: string
  n: number
  latest: number
}

function summarize(rows: OpenRow[]): Map<number, FlagSummary> {
  const map = new Map<number, FlagSummary>()
  for (const row of rows) {
    const summary = map.get(row.target_id) ?? { reasons: {}, total: 0, latestAt: 0 }
    summary.reasons[row.reason] = (summary.reasons[row.reason] ?? 0) + row.n
    summary.total += row.n
    summary.latestAt = Math.max(summary.latestAt, row.latest)
    map.set(row.target_id, summary)
  }
  return map
}

const byWeight = (a: FlagSummary, b: FlagSummary) => b.total - a.total || b.latestAt - a.latestAt

/** The moderator queue: live items and comments with open flags, most flagged first. */
export function flagQueue(db: Db): { items: FlaggedItem[]; comments: FlaggedComment[] } {
  const itemRows = db
    .query<OpenRow, []>(
      `SELECT f.item_id AS target_id, f.reason, count(*) AS n, max(f.created_at) AS latest
       FROM flags f JOIN items i ON i.id = f.item_id
       WHERE f.resolved_at IS NULL AND i.deleted = 0
       GROUP BY f.item_id, f.reason`,
    )
    .all()
  const commentRows = db
    .query<OpenRow, []>(
      `SELECT f.comment_id AS target_id, f.reason, count(*) AS n, max(f.created_at) AS latest
       FROM flags f JOIN comments c ON c.id = f.comment_id
       WHERE f.resolved_at IS NULL AND c.deleted = 0
       GROUP BY f.comment_id, f.reason`,
    )
    .all()

  const itemSummary = summarize(itemRows)
  const items = itemSummaries(db, [...itemSummary.keys()])
    .map((item) => ({ item, ...(itemSummary.get(item.id) as FlagSummary) }))
    .sort(byWeight)

  const commentSummary = summarize(commentRows)
  const listings = commentListings(db, [...commentSummary.keys()])
  const comments = [...commentSummary.entries()]
    .map(([id, summary]) => {
      const comment = listings.get(id)
      return comment ? { comment, ...summary } : null
    })
    .filter((row): row is FlaggedComment => row !== null)
    .sort(byWeight)

  return { items, comments }
}
