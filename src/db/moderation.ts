// Moderator actions (ADR 0003, 0007). Every one writes a row to the public moderation log in the
// same transaction as the change, with the moderator's reason, so the log cannot miss an action.

import { excerpt } from '../lib/markdown.ts'
import { resolveFlags } from './flags.ts'
import type { Db } from './index.ts'
import { revokeInvite, revokeInvitesBy } from './invites.ts'
import { deleteUserSessions } from './sessions.ts'
import type { Removal } from './types.ts'
import { createTag, setItemTags } from './write.ts'

const nowSeconds = () => Math.floor(Date.now() / 1000)

export type ModAction =
  | 'delete_item'
  | 'restore_item'
  | 'edit_item'
  | 'retag_item'
  | 'delete_comment'
  | 'restore_comment'
  | 'ban_user'
  | 'unban_user'
  | 'revoke_invite'
  | 'create_tag'
  | 'dismiss_flags'

export interface ModLogInput {
  moderatorId: number
  action: ModAction
  reason: string
  subject?: string
  itemId?: number | null
  commentId?: number | null
  subjectUserId?: number | null
  createdAt?: number
}

export function logModeration(db: Db, entry: ModLogInput): number {
  const row = db
    .query<
      { id: number },
      [number, string, number | null, number | null, number | null, string, string, number]
    >(
      `INSERT INTO mod_log (moderator_id, action, item_id, comment_id, subject_user_id, subject,
                            reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      entry.moderatorId,
      entry.action,
      entry.itemId ?? null,
      entry.commentId ?? null,
      entry.subjectUserId ?? null,
      entry.subject ?? '',
      entry.reason,
      entry.createdAt ?? nowSeconds(),
    )
  if (!row) throw new Error('could not write the moderation log')
  return row.id
}

function itemSubject(item: { title: string | null; body_md: string }): string {
  return item.title ?? excerpt(item.body_md.replace(/\s+/g, ' ').trim(), 80)
}

interface ItemRow {
  title: string | null
  body_md: string
  author_id: number
  deleted: number
  deleted_by: number | null
}

function itemRow(db: Db, itemId: number): ItemRow | null {
  return db
    .query<ItemRow, [number]>(
      'SELECT title, body_md, author_id, deleted, deleted_by FROM items WHERE id = ?',
    )
    .get(itemId)
}

/** Remove a live item. Its open flags are resolved. False if it was already gone. */
export function deleteItem(
  db: Db,
  itemId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const item = itemRow(db, itemId)
    if (!item || item.deleted === 1) return false
    db.query('UPDATE items SET deleted = 1, deleted_at = ?, deleted_by = ? WHERE id = ?').run(
      at,
      moderatorId,
      itemId,
    )
    resolveFlags(db, 'item', itemId, at)
    logModeration(db, {
      moderatorId,
      action: 'delete_item',
      itemId,
      subjectUserId: item.author_id,
      subject: itemSubject(item),
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** Undo a moderator's removal. An item its author deleted stays deleted. */
export function restoreItem(
  db: Db,
  itemId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const item = itemRow(db, itemId)
    if (!item || item.deleted === 0 || item.deleted_by === item.author_id) return false
    db.query('UPDATE items SET deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(
      itemId,
    )
    logModeration(db, {
      moderatorId,
      action: 'restore_item',
      itemId,
      subjectUserId: item.author_id,
      subject: itemSubject(item),
      reason,
      createdAt: at,
    })
    return true
  })()
}

interface CommentRow {
  item_id: number
  author_id: number
  deleted: number
  deleted_by: number | null
  body_md: string
}

function commentRow(db: Db, commentId: number): CommentRow | null {
  return db
    .query<CommentRow, [number]>(
      'SELECT item_id, author_id, deleted, deleted_by, body_md FROM comments WHERE id = ?',
    )
    .get(commentId)
}

function commentSubject(comment: CommentRow): string {
  return `A comment on item ${comment.item_id}`
}

/** Remove a live comment. Its replies stay; its open flags are resolved. */
export function deleteComment(
  db: Db,
  commentId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const comment = commentRow(db, commentId)
    if (!comment || comment.deleted === 1) return false
    db.query('UPDATE comments SET deleted = 1, deleted_at = ?, deleted_by = ? WHERE id = ?').run(
      at,
      moderatorId,
      commentId,
    )
    db.query('UPDATE items SET comment_count = comment_count - 1 WHERE id = ?').run(comment.item_id)
    resolveFlags(db, 'comment', commentId, at)
    logModeration(db, {
      moderatorId,
      action: 'delete_comment',
      itemId: comment.item_id,
      commentId,
      subjectUserId: comment.author_id,
      subject: commentSubject(comment),
      reason,
      createdAt: at,
    })
    return true
  })()
}

export function restoreComment(
  db: Db,
  commentId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const comment = commentRow(db, commentId)
    if (!comment || comment.deleted === 0 || comment.deleted_by === comment.author_id) return false
    db.query(
      'UPDATE comments SET deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?',
    ).run(commentId)
    db.query('UPDATE items SET comment_count = comment_count + 1 WHERE id = ?').run(comment.item_id)
    logModeration(db, {
      moderatorId,
      action: 'restore_comment',
      itemId: comment.item_id,
      commentId,
      subjectUserId: comment.author_id,
      subject: commentSubject(comment),
      reason,
      createdAt: at,
    })
    return true
  })()
}

export type BanResult = { ok: true } | { ok: false; reason: 'missing' | 'moderator' | 'already' }

/**
 * Ban a member: every session ends at once and their open invitations are revoked. Moderators
 * cannot be banned; take them out of MODERATORS first.
 */
export function banUser(
  db: Db,
  userId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): BanResult {
  return db.transaction((): BanResult => {
    const user = db
      .query<{ login: string; is_moderator: number; banned: number }, [number]>(
        'SELECT login, is_moderator, banned FROM users WHERE id = ?',
      )
      .get(userId)
    if (!user) return { ok: false, reason: 'missing' }
    if (user.is_moderator === 1) return { ok: false, reason: 'moderator' }
    if (user.banned === 1) return { ok: false, reason: 'already' }
    db.query('UPDATE users SET banned = 1, banned_at = ?, banned_reason = ? WHERE id = ?').run(
      at,
      reason,
      userId,
    )
    deleteUserSessions(db, userId)
    revokeInvitesBy(db, userId, at)
    logModeration(db, {
      moderatorId,
      action: 'ban_user',
      subjectUserId: userId,
      subject: user.login,
      reason,
      createdAt: at,
    })
    return { ok: true }
  })()
}

export function unbanUser(
  db: Db,
  userId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const user = db
      .query<{ login: string; banned: number }, [number]>(
        'SELECT login, banned FROM users WHERE id = ?',
      )
      .get(userId)
    if (!user || user.banned === 0) return false
    db.query(
      'UPDATE users SET banned = 0, banned_at = NULL, banned_reason = NULL WHERE id = ?',
    ).run(userId)
    logModeration(db, {
      moderatorId,
      action: 'unban_user',
      subjectUserId: userId,
      subject: user.login,
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** Change an item's tags. The log entry records the tags before and after. */
export function retagItem(
  db: Db,
  itemId: number,
  tags: string[],
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const item = itemRow(db, itemId)
    if (!item) return false
    const before = db
      .query<{ name: string }, [number]>(
        `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = ? ORDER BY t.name`,
      )
      .all(itemId)
      .map((row) => row.name)
    setItemTags(db, itemId, tags)
    const after = [...new Set(tags)].sort()
    logModeration(db, {
      moderatorId,
      action: 'retag_item',
      itemId,
      subjectUserId: item.author_id,
      subject: `${itemSubject(item)} (tags were ${before.join(', ')}; now ${after.join(', ')})`,
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** Keep a flagged item or comment where it is: its open flags are resolved. */
export function dismissFlags(
  db: Db,
  target: 'item' | 'comment',
  id: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    if (target === 'item') {
      const item = itemRow(db, id)
      if (!item) return false
      if (resolveFlags(db, 'item', id, at) === 0) return false
      logModeration(db, {
        moderatorId,
        action: 'dismiss_flags',
        itemId: id,
        subjectUserId: item.author_id,
        subject: itemSubject(item),
        reason,
        createdAt: at,
      })
      return true
    }
    const comment = commentRow(db, id)
    if (!comment) return false
    if (resolveFlags(db, 'comment', id, at) === 0) return false
    logModeration(db, {
      moderatorId,
      action: 'dismiss_flags',
      itemId: comment.item_id,
      commentId: id,
      subjectUserId: comment.author_id,
      subject: commentSubject(comment),
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** A new tag. False if the name is taken. */
export function createTagAsModerator(
  db: Db,
  tag: { name: string; description: string },
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const taken = db
      .query<{ id: number }, [string]>('SELECT id FROM tags WHERE name = ?')
      .get(tag.name)
    if (taken) return false
    createTag(db, tag.name, tag.description, at)
    logModeration(db, {
      moderatorId,
      action: 'create_tag',
      subject: tag.name,
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** Revoke someone else's open invitation. */
export function revokeInviteAsModerator(
  db: Db,
  inviteId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const invite = db
      .query<{ login: string; inviter_id: number }, [number]>(
        `SELECT u.login, v.inviter_id FROM invites v JOIN users u ON u.id = v.inviter_id
         WHERE v.id = ?`,
      )
      .get(inviteId)
    if (!invite || !revokeInvite(db, inviteId, at)) return false
    logModeration(db, {
      moderatorId,
      action: 'revoke_invite',
      subjectUserId: invite.inviter_id,
      subject: `An invitation from ${invite.login}`,
      reason,
      createdAt: at,
    })
    return true
  })()
}

/** What moderators removed recently and could restore, newest first. */
export function recentRemovals(db: Db, limit = 30): Removal[] {
  const items = db
    .query<
      {
        id: number
        title: string | null
        body_md: string
        login: string
        deleted_at: number
      },
      [number]
    >(
      `SELECT i.id, i.title, i.body_md, u.login, i.deleted_at FROM items i
       JOIN users u ON u.id = i.author_id
       WHERE i.deleted = 1 AND (i.deleted_by IS NULL OR i.deleted_by <> i.author_id)
       ORDER BY i.deleted_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(
      (row): Removal => ({
        kind: 'item',
        id: row.id,
        itemId: row.id,
        label: itemSubject(row),
        author: row.login,
        removedAt: row.deleted_at,
      }),
    )
  const comments = db
    .query<
      { id: number; item_id: number; body_md: string; login: string; deleted_at: number },
      [number]
    >(
      `SELECT c.id, c.item_id, c.body_md, u.login, c.deleted_at FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.deleted = 1 AND (c.deleted_by IS NULL OR c.deleted_by <> c.author_id)
       ORDER BY c.deleted_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(
      (row): Removal => ({
        kind: 'comment',
        id: row.id,
        itemId: row.item_id,
        label: excerpt(row.body_md.replace(/\s+/g, ' ').trim(), 80),
        author: row.login,
        removedAt: row.deleted_at,
      }),
    )
  return [...items, ...comments].sort((a, b) => b.removedAt - a.removedAt).slice(0, limit)
}
