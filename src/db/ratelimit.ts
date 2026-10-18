// Rate limits (ADR 0007): a count of a member's actions in the last hour, from one small table.
// Rows older than the window are pruned whenever the member acts again.

import type { Db } from './index.ts'

export const RATE_WINDOW = 3600

/**
 * Count the action if the member is under `limit` in the last hour, and return true; return false
 * (and count nothing) if they are at the limit.
 */
export function takeRate(
  db: Db,
  userId: number,
  action: string,
  limit: number,
  now: number,
): boolean {
  return db.transaction(() => {
    db.query('DELETE FROM rate_events WHERE user_id = ? AND action = ? AND created_at <= ?').run(
      userId,
      action,
      now - RATE_WINDOW,
    )
    const used =
      db
        .query<{ n: number }, [number, string]>(
          'SELECT count(*) AS n FROM rate_events WHERE user_id = ? AND action = ?',
        )
        .get(userId, action)?.n ?? 0
    if (used >= limit) return false
    db.query('INSERT INTO rate_events (user_id, action, created_at) VALUES (?, ?, ?)').run(
      userId,
      action,
      now,
    )
    return true
  })()
}
