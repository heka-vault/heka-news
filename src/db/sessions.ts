// Sessions (ADR 0003, 0007). `id` is the SHA-256 of the cookie token; the token itself is never
// stored. Expiry slides: each request more than RULES.sessionRefresh after the last one pushes it
// another RULES.sessionTtl forward.

import type { Db } from './index.ts'
import type { Member } from './types.ts'

export interface SessionInfo {
  member: Member
  expiresAt: number
  lastSeenAt: number
}

export function createSession(db: Db, id: string, userId: number, now: number, ttl: number): void {
  db.query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, now, now + ttl, now)
}

/** The session and its member, if it exists, has not expired and the member is not banned. */
export function getSession(db: Db, id: string, now: number): SessionInfo | null {
  const row = db
    .query<
      {
        user_id: number
        login: string
        display_name: string | null
        is_moderator: number
        expires_at: number
        last_seen_at: number
      },
      [string, number]
    >(
      `SELECT s.user_id, u.login, u.display_name, u.is_moderator, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.banned = 0`,
    )
    .get(id, now)
  if (!row) return null
  return {
    member: {
      id: row.user_id,
      login: row.login,
      displayName: row.display_name,
      isModerator: row.is_moderator === 1,
    },
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function touchSession(db: Db, id: string, now: number, ttl: number): void {
  db.query('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
    now,
    now + ttl,
    id,
  )
}

export function deleteSession(db: Db, id: string): void {
  db.query('DELETE FROM sessions WHERE id = ?').run(id)
}

/** Sign a member out everywhere. Returns the number of sessions ended. */
export function deleteUserSessions(db: Db, userId: number): number {
  return db.query('DELETE FROM sessions WHERE user_id = ?').run(userId).changes
}

export function purgeExpiredSessions(db: Db, now: number): number {
  return db.query('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes
}

export function countSessions(db: Db, userId: number): number {
  return (
    db
      .query<{ n: number }, [number]>('SELECT count(*) AS n FROM sessions WHERE user_id = ?')
      .get(userId)?.n ?? 0
  )
}
