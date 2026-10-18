// Votes (ADR 0007): one upvote per member per item or comment, never on your own, and you can take
// it back. The point count changes in the same transaction as the vote row.

import type { Db } from './index.ts'

export type VoteResult =
  | { ok: true; points: number; voted: boolean }
  | { ok: false; reason: 'missing' | 'own' }

type Target = 'item' | 'comment'

const TABLES: Record<Target, { votes: string; column: string; table: string }> = {
  item: { votes: 'item_votes', column: 'item_id', table: 'items' },
  comment: { votes: 'comment_votes', column: 'comment_id', table: 'comments' },
}

/**
 * Set a member's vote on an item or comment to `up`. Idempotent: voting twice counts once, and
 * taking back a vote that is not there changes nothing.
 */
export function setVote(
  db: Db,
  target: Target,
  id: number,
  userId: number,
  up: boolean,
  now: number,
): VoteResult {
  const t = TABLES[target]
  return db.transaction((): VoteResult => {
    const row = db
      .query<{ author_id: number }, [number]>(
        `SELECT author_id FROM ${t.table} WHERE id = ? AND deleted = 0`,
      )
      .get(id)
    if (!row) return { ok: false, reason: 'missing' }
    if (row.author_id === userId) return { ok: false, reason: 'own' }
    const changed = up
      ? db
          .query(
            `INSERT INTO ${t.votes} (user_id, ${t.column}, created_at) VALUES (?, ?, ?)
             ON CONFLICT DO NOTHING`,
          )
          .run(userId, id, now).changes
      : db.query(`DELETE FROM ${t.votes} WHERE user_id = ? AND ${t.column} = ?`).run(userId, id)
          .changes
    if (changed === 1) {
      db.query(`UPDATE ${t.table} SET points = points + ? WHERE id = ?`).run(up ? 1 : -1, id)
    }
    const points =
      db.query<{ points: number }, [number]>(`SELECT points FROM ${t.table} WHERE id = ?`).get(id)
        ?.points ?? 0
    return { ok: true, points, voted: up }
  })()
}

/** Which of these items the member has voted on. */
export function votedItems(db: Db, userId: number, itemIds: number[]): Set<number> {
  if (itemIds.length === 0) return new Set()
  return new Set(
    db
      .query<{ item_id: number }, number[]>(
        `SELECT item_id FROM item_votes WHERE user_id = ?
         AND item_id IN (${itemIds.map(() => '?').join(',')})`,
      )
      .all(userId, ...itemIds)
      .map((row) => row.item_id),
  )
}

/** Which comments on an item the member has voted on. */
export function votedComments(db: Db, userId: number, itemId: number): Set<number> {
  return new Set(
    db
      .query<{ comment_id: number }, [number, number]>(
        `SELECT v.comment_id FROM comment_votes v JOIN comments c ON c.id = v.comment_id
         WHERE v.user_id = ? AND c.item_id = ?`,
      )
      .all(userId, itemId)
      .map((row) => row.comment_id),
  )
}
