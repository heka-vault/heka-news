// The Discord bridge's bookkeeping (ADR 0009): the outbox, which thread is which item, which
// message is which comment, carrying a message in as a comment, and the one-time nudges.

import type { Db } from './index.ts'
import { createComment } from './write.ts'

export type OutboxKind =
  | 'item_created'
  | 'item_updated'
  | 'item_removed'
  | 'item_restored'
  | 'comment_created'
  | 'comment_updated'
  | 'comment_deleted'

export interface OutboxRow {
  id: number
  kind: OutboxKind
  itemId: number | null
  commentId: number | null
  attempts: number
}

export function enqueue(
  db: Db,
  kind: OutboxKind,
  ref: { itemId?: number; commentId?: number },
  now: number,
): void {
  db.query(
    `INSERT INTO discord_outbox (kind, item_id, comment_id, created_at, next_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(kind, ref.itemId ?? null, ref.commentId ?? null, now, now)
}

/**
 * Work that is due, strictly oldest first: the queue stops at the first row still waiting for a
 * retry, so a comment never goes out before the thread it belongs in.
 */
export function dueOutbox(db: Db, now: number, limit = 20): OutboxRow[] {
  const rows = db
    .query<
      {
        id: number
        kind: OutboxKind
        item_id: number | null
        comment_id: number | null
        attempts: number
        next_at: number
      },
      [number]
    >(
      `SELECT id, kind, item_id, comment_id, attempts, next_at FROM discord_outbox
       ORDER BY id LIMIT ?`,
    )
    .all(limit)
  const due: OutboxRow[] = []
  for (const row of rows) {
    if (row.next_at > now) break
    due.push({
      id: row.id,
      kind: row.kind,
      itemId: row.item_id,
      commentId: row.comment_id,
      attempts: row.attempts,
    })
  }
  return due
}

export function finishOutbox(db: Db, id: number): void {
  db.query('DELETE FROM discord_outbox WHERE id = ?').run(id)
}

export function retryOutbox(db: Db, id: number, error: string, nextAt: number): void {
  db.query(
    'UPDATE discord_outbox SET attempts = attempts + 1, last_error = ?, next_at = ? WHERE id = ?',
  ).run(error.slice(0, 500), nextAt, id)
}

export function outboxSize(db: Db): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM discord_outbox').get()?.n ?? 0
}

// --- Threads and messages --------------------------------------------------------------------

export function threadForItem(db: Db, itemId: number): string | null {
  return (
    db
      .query<{ thread_id: string }, [number]>(
        'SELECT thread_id FROM discord_threads WHERE item_id = ?',
      )
      .get(itemId)?.thread_id ?? null
  )
}

export function itemForThread(db: Db, threadId: string): number | null {
  return (
    db
      .query<{ item_id: number }, [string]>(
        'SELECT item_id FROM discord_threads WHERE thread_id = ?',
      )
      .get(threadId)?.item_id ?? null
  )
}

export function saveThread(db: Db, itemId: number, threadId: string, now: number): void {
  db.query(
    `INSERT INTO discord_threads (item_id, thread_id, created_at, active_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (item_id) DO NOTHING`,
  ).run(itemId, threadId, now, now)
}

export interface MessageRef {
  messageId: string
  commentId: number
  threadId: string
  origin: 'site' | 'discord'
}

const toRef = (row: {
  message_id: string
  comment_id: number
  thread_id: string
  origin: 'site' | 'discord'
}): MessageRef => ({
  messageId: row.message_id,
  commentId: row.comment_id,
  threadId: row.thread_id,
  origin: row.origin,
})

export function messageForComment(db: Db, commentId: number): MessageRef | null {
  const row = db
    .query<Parameters<typeof toRef>[0], [number]>(
      'SELECT message_id, comment_id, thread_id, origin FROM discord_messages WHERE comment_id = ?',
    )
    .get(commentId)
  return row ? toRef(row) : null
}

export function commentForMessage(db: Db, messageId: string): MessageRef | null {
  const row = db
    .query<Parameters<typeof toRef>[0], [string]>(
      'SELECT message_id, comment_id, thread_id, origin FROM discord_messages WHERE message_id = ?',
    )
    .get(messageId)
  return row ? toRef(row) : null
}

/** Record the webhook copy of a comment written here. */
export function saveSiteMessage(
  db: Db,
  ref: { messageId: string; commentId: number; threadId: string },
  now: number,
): void {
  db.transaction(() => {
    db.query(
      `INSERT INTO discord_messages (message_id, comment_id, thread_id, origin, created_at)
       VALUES (?, ?, ?, 'site', ?) ON CONFLICT (comment_id) DO NOTHING`,
    ).run(ref.messageId, ref.commentId, ref.threadId, now)
    touchThread(db, ref.threadId, now)
  })()
}

export function forgetMessage(db: Db, messageId: string): void {
  db.query('DELETE FROM discord_messages WHERE message_id = ?').run(messageId)
}

function touchThread(db: Db, threadId: string, now: number): void {
  db.query('UPDATE discord_threads SET active_at = max(active_at, ?) WHERE thread_id = ?').run(
    now,
    threadId,
  )
}

/**
 * Threads with activity since `since`, each with the newest message carried in from Discord (the
 * bot replays what came after it). Snowflakes compare as numbers: longer is newer, then by text.
 */
export function activeThreads(db: Db, since: number): { threadId: string; after: string | null }[] {
  return db
    .query<{ thread_id: string; after: string | null }, [number]>(
      `SELECT t.thread_id,
              (SELECT m.message_id FROM discord_messages m
               WHERE m.thread_id = t.thread_id AND m.origin = 'discord'
               ORDER BY length(m.message_id) DESC, m.message_id DESC LIMIT 1) AS after
       FROM discord_threads t WHERE t.active_at >= ? ORDER BY t.active_at DESC`,
    )
    .all(since)
    .map((row) => ({ threadId: row.thread_id, after: row.after }))
}

// --- Carrying messages in ---------------------------------------------------------------------

export interface DiscordMember {
  id: number
  login: string
  banned: boolean
}

/** The member who linked this Discord account, or null. */
export function memberByDiscordId(db: Db, discordId: string): DiscordMember | null {
  const row = db
    .query<{ id: number; login: string; banned: number }, [string]>(
      `SELECT u.id, u.login, u.banned FROM discord_links l JOIN users u ON u.id = l.user_id
       WHERE l.discord_id = ?`,
    )
    .get(discordId)
  return row ? { id: row.id, login: row.login, banned: row.banned === 1 } : null
}

/**
 * A message from the forum becomes a comment, marked as from Discord, with its message id recorded
 * so the same message is never carried twice. Returns null when it already was.
 */
export function carryComment(
  db: Db,
  carried: {
    itemId: number
    authorId: number
    parentId: number | null
    bodyMd: string
    messageId: string
    threadId: string
  },
  now: number,
): number | null {
  return db.transaction(() => {
    if (commentForMessage(db, carried.messageId)) return null
    const id = createComment(db, {
      itemId: carried.itemId,
      authorId: carried.authorId,
      parentId: carried.parentId,
      bodyMd: carried.bodyMd,
      createdAt: now,
      source: 'discord',
    })
    db.query(
      `INSERT INTO discord_messages (message_id, comment_id, thread_id, origin, created_at)
       VALUES (?, ?, ?, 'discord', ?)`,
    ).run(carried.messageId, id, carried.threadId, now)
    touchThread(db, carried.threadId, now)
    return id
  })()
}

/** True the first time a Discord user is nudged to connect; false ever after. */
export function takeNudge(db: Db, discordId: string, now: number): boolean {
  return (
    db
      .query(
        'INSERT INTO discord_nudges (discord_id, nudged_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
      .run(discordId, now).changes === 1
  )
}

// --- What goes out ------------------------------------------------------------------------------

export interface OutboundItem {
  id: number
  kind: 'link' | 'post' | 'status'
  title: string | null
  url: string | null
  bodyMd: string
  login: string
  tags: string[]
  deleted: boolean
}

export function outboundItem(db: Db, itemId: number): OutboundItem | null {
  const row = db
    .query<
      {
        id: number
        kind: OutboundItem['kind']
        title: string | null
        url: string | null
        body_md: string
        login: string
        deleted: number
      },
      [number]
    >(
      `SELECT i.id, i.kind, i.title, i.url, i.body_md, u.login, i.deleted
       FROM items i JOIN users u ON u.id = i.author_id WHERE i.id = ?`,
    )
    .get(itemId)
  if (!row) return null
  const tags = db
    .query<{ name: string }, [number]>(
      `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
       WHERE it.item_id = ? ORDER BY t.name`,
    )
    .all(itemId)
    .map((t) => t.name)
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    bodyMd: row.body_md,
    login: row.login,
    tags,
    deleted: row.deleted === 1,
  }
}

export interface OutboundComment {
  id: number
  itemId: number
  bodyMd: string
  login: string
  avatarUrl: string | null
  deleted: boolean
  source: 'site' | 'discord'
  parent: { login: string; bodyMd: string; deleted: boolean } | null
}

export function outboundComment(db: Db, commentId: number): OutboundComment | null {
  const row = db
    .query<
      {
        id: number
        item_id: number
        parent_id: number | null
        body_md: string
        login: string
        avatar_url: string | null
        deleted: number
        source: 'site' | 'discord'
      },
      [number]
    >(
      `SELECT c.id, c.item_id, c.parent_id, c.body_md, u.login, u.avatar_url, c.deleted, c.source
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
    )
    .get(commentId)
  if (!row) return null
  const parent =
    row.parent_id === null
      ? null
      : db
          .query<{ login: string; body_md: string; deleted: number }, [number]>(
            `SELECT u.login, c.body_md, c.deleted FROM comments c JOIN users u ON u.id = c.author_id
             WHERE c.id = ?`,
          )
          .get(row.parent_id)
  return {
    id: row.id,
    itemId: row.item_id,
    bodyMd: row.body_md,
    login: row.login,
    avatarUrl: row.avatar_url,
    deleted: row.deleted === 1,
    source: row.source,
    parent: parent
      ? { login: parent.login, bodyMd: parent.body_md, deleted: parent.deleted === 1 }
      : null,
  }
}
