// "Talk to us" bookkeeping (ADR 0008): the per-visitor hourly limit, the daily cap on conversation
// tokens, and the conversations already posted to Discord.

import type { Db } from './index.ts'

export const TALK_WINDOW = 3600

/** The UTC day of a unix time, as YYYY-MM-DD. */
export function utcDay(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 10)
}

/**
 * Count a token request against the visitor's hourly limit and return true, or return false (and
 * count nothing) when they are at it. Prunes every visitor's rows older than the window.
 */
export function takeVisitorRate(db: Db, visitor: string, limit: number, now: number): boolean {
  return db.transaction(() => {
    db.query('DELETE FROM talk_visitors WHERE created_at <= ?').run(now - TALK_WINDOW)
    const used =
      db
        .query<{ n: number }, [string]>('SELECT count(*) AS n FROM talk_visitors WHERE visitor = ?')
        .get(visitor)?.n ?? 0
    if (used >= limit) return false
    db.query('INSERT INTO talk_visitors (visitor, created_at) VALUES (?, ?)').run(visitor, now)
    return true
  })()
}

/**
 * Reserve one of today's tokens and return true, or return false when the day is at `limit`.
 * Reserving before asking ElevenLabs keeps simultaneous requests from going past the cap;
 * `releaseDailyToken` gives the reservation back when no token was issued.
 */
export function reserveDailyToken(db: Db, limit: number, now: number): boolean {
  const day = utcDay(now)
  return db.transaction(() => {
    const used =
      db.query<{ n: number }, [string]>('SELECT tokens AS n FROM talk_days WHERE day = ?').get(day)
        ?.n ?? 0
    if (used >= limit) return false
    db.query(
      'INSERT INTO talk_days (day, tokens) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET tokens = tokens + 1',
    ).run(day)
    return true
  })()
}

/** Give back a reservation from `reserveDailyToken` that did not become a token. */
export function releaseDailyToken(db: Db, now: number): void {
  db.query('UPDATE talk_days SET tokens = max(tokens - 1, 0) WHERE day = ?').run(utcDay(now))
}

/** Tokens issued on the UTC day of `now`. */
export function tokensIssued(db: Db, now: number): number {
  return (
    db
      .query<{ n: number }, [string]>('SELECT tokens AS n FROM talk_days WHERE day = ?')
      .get(utcDay(now))?.n ?? 0
  )
}

/** True when this conversation's summary already reached Discord. */
export function conversationPosted(db: Db, conversationId: string): boolean {
  return (
    db
      .query<{ n: number }, [string]>(
        'SELECT count(*) AS n FROM talk_conversations WHERE conversation_id = ?',
      )
      .get(conversationId)?.n === 1
  )
}

/** Record that this conversation's summary reached Discord. Idempotent. */
export function markConversationPosted(db: Db, conversationId: string, now: number): void {
  db.query(
    'INSERT INTO talk_conversations (conversation_id, posted_at) VALUES (?, ?) ON CONFLICT (conversation_id) DO NOTHING',
  ).run(conversationId, now)
}
