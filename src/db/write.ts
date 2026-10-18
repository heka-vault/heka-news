// Writing: the functions the seed script uses today and the phase 3 routes will use. Each keeps
// the denormalized counters and the rendered HTML in step with the row it writes, in one
// transaction. Rules that a trigger could enforce live here instead (ADR 0002).

import { domainOf } from '../lib/format.ts'
import { MARKDOWN_VERSION, renderMarkdown } from '../lib/markdown.ts'
import type { Db } from './index.ts'
import type { ItemKind } from './types.ts'

export const MAX_TAGS = 3

const nowSeconds = () => Math.floor(Date.now() / 1000)

export interface NewUser {
  login: string
  githubId?: number | null
  displayName?: string | null
  bio?: string
  invitedBy?: number | null
  isModerator?: boolean
  createdAt?: number
}

export function createUser(db: Db, user: NewUser): number {
  const row = db
    .query<
      { id: number },
      [number | null, string, string | null, string, number | null, number, number]
    >(
      `INSERT INTO users (github_id, login, display_name, bio, invited_by, is_moderator, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      user.githubId ?? null,
      user.login,
      user.displayName ?? null,
      user.bio ?? '',
      user.invitedBy ?? null,
      user.isModerator ? 1 : 0,
      user.createdAt ?? nowSeconds(),
    )
  if (!row) throw new Error(`could not create user ${user.login}`)
  return row.id
}

export function createTag(
  db: Db,
  name: string,
  description = '',
  createdAt = nowSeconds(),
): number {
  const row = db
    .query<{ id: number }, [string, string, number]>(
      `INSERT INTO tags (name, description, created_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET description = excluded.description RETURNING id`,
    )
    .get(name, description, createdAt)
  if (!row) throw new Error(`could not create tag ${name}`)
  return row.id
}

export interface NewItem {
  kind: ItemKind
  authorId: number
  title?: string | null
  url?: string | null
  bodyMd?: string
  tags: string[]
  createdAt?: number
  /** Starts at 1, the author's own vote (ADR 0004). The seed sets other values directly. */
  points?: number
}

export function createItem(db: Db, item: NewItem): number {
  const tags = [...new Set(item.tags)]
  if (tags.length < 1 || tags.length > MAX_TAGS) {
    throw new Error(`an item needs 1 to ${MAX_TAGS} tags, got ${tags.length}`)
  }
  const bodyMd = item.bodyMd ?? ''
  const url = item.kind === 'link' ? (item.url ?? null) : null
  const domain = url ? domainOf(url) : null
  if (item.kind === 'link' && !domain) throw new Error(`not an http(s) URL: ${url}`)
  const bodyHtml = bodyMd ? renderMarkdown(bodyMd, item.kind === 'post' ? 'post' : 'comment') : ''

  return db.transaction(() => {
    const row = db
      .query<
        { id: number },
        [
          ItemKind,
          string | null,
          string | null,
          string | null,
          string,
          string,
          number,
          number,
          number,
          number,
        ]
      >(
        `INSERT INTO items (kind, title, url, domain, body_md, body_html, body_html_v, author_id,
                            created_at, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        item.kind,
        item.kind === 'status' ? null : (item.title ?? null),
        url,
        domain,
        bodyMd,
        bodyHtml,
        MARKDOWN_VERSION,
        item.authorId,
        item.createdAt ?? nowSeconds(),
        item.points ?? 1,
      )
    if (!row) throw new Error('could not create item')
    const tagId = db.query<{ id: number }, [string]>('SELECT id FROM tags WHERE name = ?')
    const link = db.query('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)')
    for (const name of tags) {
      const tag = tagId.get(name)
      if (!tag) throw new Error(`unknown tag ${name}`)
      link.run(row.id, tag.id)
    }
    return row.id
  })()
}

export interface NewComment {
  itemId: number
  authorId: number
  parentId?: number | null
  bodyMd: string
  createdAt?: number
  points?: number
}

export function createComment(db: Db, comment: NewComment): number {
  return db.transaction(() => {
    let path = ''
    let depth = 0
    if (comment.parentId) {
      const parent = db
        .query<{ path: string; depth: number; item_id: number }, [number]>(
          'SELECT path, depth, item_id FROM comments WHERE id = ?',
        )
        .get(comment.parentId)
      if (!parent || parent.item_id !== comment.itemId) throw new Error('parent comment not found')
      path = `${parent.path}/`
      depth = parent.depth + 1
    }
    const row = db
      .query<
        { id: number },
        [number, number | null, number, string, number, string, string, number, number, number]
      >(
        `INSERT INTO comments (item_id, parent_id, author_id, path, depth, body_md, body_html,
                               body_html_v, created_at, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        comment.itemId,
        comment.parentId ?? null,
        comment.authorId,
        'pending',
        depth,
        comment.bodyMd,
        renderMarkdown(comment.bodyMd, 'comment'),
        MARKDOWN_VERSION,
        comment.createdAt ?? nowSeconds(),
        comment.points ?? 1,
      )
    if (!row) throw new Error('could not create comment')
    db.query('UPDATE comments SET path = ? WHERE id = ?').run(
      `${path}${String(row.id).padStart(10, '0')}`,
      row.id,
    )
    db.query('UPDATE items SET comment_count = comment_count + 1 WHERE id = ?').run(comment.itemId)
    return row.id
  })()
}

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

/** Remove an item as a moderator, with a log entry. The row stays; pages show it as removed. */
export function deleteItem(
  db: Db,
  itemId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): void {
  db.transaction(() => {
    const item = db
      .query<{ title: string | null; body_md: string; author_id: number }, [number]>(
        'SELECT title, body_md, author_id FROM items WHERE id = ?',
      )
      .get(itemId)
    if (!item) throw new Error(`no item ${itemId}`)
    db.query('UPDATE items SET deleted = 1, deleted_at = ? WHERE id = ?').run(at, itemId)
    logModeration(db, {
      moderatorId,
      action: 'delete_item',
      itemId,
      subjectUserId: item.author_id,
      subject: item.title ?? item.body_md.slice(0, 80),
      reason,
      createdAt: at,
    })
  })()
}

/** Remove a comment as a moderator, with a log entry. Its replies stay. */
export function deleteComment(
  db: Db,
  commentId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): void {
  db.transaction(() => {
    const comment = db
      .query<{ item_id: number; author_id: number }, [number]>(
        'SELECT item_id, author_id FROM comments WHERE id = ? AND deleted = 0',
      )
      .get(commentId)
    if (!comment) throw new Error(`no live comment ${commentId}`)
    db.query('UPDATE comments SET deleted = 1, deleted_at = ? WHERE id = ?').run(at, commentId)
    db.query('UPDATE items SET comment_count = comment_count - 1 WHERE id = ?').run(comment.item_id)
    logModeration(db, {
      moderatorId,
      action: 'delete_comment',
      itemId: comment.item_id,
      commentId,
      subjectUserId: comment.author_id,
      subject: `A comment on item ${comment.item_id}`,
      reason,
      createdAt: at,
    })
  })()
}

/** Ban a member as a moderator, with a log entry. */
export function banUser(
  db: Db,
  userId: number,
  moderatorId: number,
  reason: string,
  at = nowSeconds(),
): void {
  db.transaction(() => {
    const user = db
      .query<{ login: string }, [number]>('SELECT login FROM users WHERE id = ?')
      .get(userId)
    if (!user) throw new Error(`no user ${userId}`)
    db.query('UPDATE users SET banned = 1, banned_at = ?, banned_reason = ? WHERE id = ?').run(
      at,
      reason,
      userId,
    )
    logModeration(db, {
      moderatorId,
      action: 'ban_user',
      subjectUserId: userId,
      subject: user.login,
      reason,
      createdAt: at,
    })
  })()
}

/** Re-render body_html for rows rendered by an older MARKDOWN_VERSION. Returns rows updated. */
export function rerenderStale(db: Db): number {
  let updated = 0
  db.transaction(() => {
    const items = db
      .query<{ id: number; kind: ItemKind; body_md: string }, [number]>(
        'SELECT id, kind, body_md FROM items WHERE body_html_v < ?',
      )
      .all(MARKDOWN_VERSION)
    const setItem = db.query('UPDATE items SET body_html = ?, body_html_v = ? WHERE id = ?')
    for (const item of items) {
      const html = item.body_md
        ? renderMarkdown(item.body_md, item.kind === 'post' ? 'post' : 'comment')
        : ''
      setItem.run(html, MARKDOWN_VERSION, item.id)
    }
    const comments = db
      .query<{ id: number; body_md: string }, [number]>(
        'SELECT id, body_md FROM comments WHERE body_html_v < ?',
      )
      .all(MARKDOWN_VERSION)
    const setComment = db.query('UPDATE comments SET body_html = ?, body_html_v = ? WHERE id = ?')
    for (const comment of comments) {
      setComment.run(renderMarkdown(comment.body_md, 'comment'), MARKDOWN_VERSION, comment.id)
    }
    updated = items.length + comments.length
  })()
  return updated
}
