// Writing members, tags, items and comments: what the routes and the seed use. Each function keeps
// the denormalized counters and the rendered HTML in step with the row it writes, in one
// transaction. Rules that a trigger could enforce live here instead (ADR 0002). Moderator actions
// are in moderation.ts, votes in votes.ts, flags in flags.ts.

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
  const bio = user.bio ?? ''
  const row = db
    .query<
      { id: number },
      [number | null, string, string | null, string, string, number, number | null, number, number]
    >(
      `INSERT INTO users (github_id, login, display_name, bio, bio_html, bio_html_v, invited_by,
                          is_moderator, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      user.githubId ?? null,
      user.login,
      user.displayName ?? null,
      bio,
      bio ? renderMarkdown(bio, 'comment') : '',
      MARKDOWN_VERSION,
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
    setItemTags(db, row.id, tags)
    return row.id
  })()
}

/** Replace an item's tags (1 to MAX_TAGS known tags). Call inside a transaction. */
export function setItemTags(db: Db, itemId: number, names: string[]): void {
  const tags = [...new Set(names)]
  if (tags.length < 1 || tags.length > MAX_TAGS) {
    throw new Error(`an item needs 1 to ${MAX_TAGS} tags, got ${tags.length}`)
  }
  const tagId = db.query<{ id: number }, [string]>('SELECT id FROM tags WHERE name = ?')
  const ids = tags.map((name) => {
    const tag = tagId.get(name)
    if (!tag) throw new Error(`unknown tag ${name}`)
    return tag.id
  })
  db.query('DELETE FROM item_tags WHERE item_id = ?').run(itemId)
  const link = db.query('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)')
  for (const id of ids) link.run(itemId, id)
}

export interface ItemEdit {
  /** Ignored for status notes. */
  title: string | null
  bodyMd: string
  tags: string[]
}

/** An author's edit: title, text and tags. The URL of a link never changes. */
export function updateItem(db: Db, itemId: number, edit: ItemEdit, at = nowSeconds()): void {
  db.transaction(() => {
    const item = db
      .query<{ kind: ItemKind }, [number]>('SELECT kind FROM items WHERE id = ?')
      .get(itemId)
    if (!item) throw new Error(`no item ${itemId}`)
    const html = edit.bodyMd
      ? renderMarkdown(edit.bodyMd, item.kind === 'post' ? 'post' : 'comment')
      : ''
    db.query(
      `UPDATE items SET title = ?, body_md = ?, body_html = ?, body_html_v = ?, edited_at = ?
       WHERE id = ?`,
    ).run(
      item.kind === 'status' ? null : edit.title,
      edit.bodyMd,
      html,
      MARKDOWN_VERSION,
      at,
      itemId,
    )
    setItemTags(db, itemId, edit.tags)
  })()
}

/** The author deletes their own item. The row stays; its page says the author deleted it. */
export function authorDeleteItem(
  db: Db,
  itemId: number,
  authorId: number,
  at = nowSeconds(),
): boolean {
  return (
    db
      .query(
        `UPDATE items SET deleted = 1, deleted_at = ?, deleted_by = ?
         WHERE id = ? AND author_id = ? AND deleted = 0`,
      )
      .run(at, authorId, itemId, authorId).changes === 1
  )
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

/** An author's edit of their comment. */
export function updateComment(db: Db, commentId: number, bodyMd: string, at = nowSeconds()): void {
  db.query(
    'UPDATE comments SET body_md = ?, body_html = ?, body_html_v = ?, edited_at = ? WHERE id = ?',
  ).run(bodyMd, renderMarkdown(bodyMd, 'comment'), MARKDOWN_VERSION, at, commentId)
}

/** The author deletes their comment. Replies keep their place under "[deleted]". */
export function authorDeleteComment(
  db: Db,
  commentId: number,
  authorId: number,
  at = nowSeconds(),
): boolean {
  return db.transaction(() => {
    const comment = db
      .query<{ item_id: number }, [number, number]>(
        'SELECT item_id FROM comments WHERE id = ? AND author_id = ? AND deleted = 0',
      )
      .get(commentId, authorId)
    if (!comment) return false
    db.query('UPDATE comments SET deleted = 1, deleted_at = ?, deleted_by = ? WHERE id = ?').run(
      at,
      authorId,
      commentId,
    )
    db.query('UPDATE items SET comment_count = comment_count - 1 WHERE id = ?').run(comment.item_id)
    return true
  })()
}

/** /settings: display name (null clears it) and bio (markdown). */
export function updateProfile(
  db: Db,
  userId: number,
  profile: { displayName: string | null; bio: string },
): void {
  db.query(
    'UPDATE users SET display_name = ?, bio = ?, bio_html = ?, bio_html_v = ? WHERE id = ?',
  ).run(
    profile.displayName,
    profile.bio,
    profile.bio ? renderMarkdown(profile.bio, 'comment') : '',
    MARKDOWN_VERSION,
    userId,
  )
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
    const users = db
      .query<{ id: number; bio: string }, [number]>(
        'SELECT id, bio FROM users WHERE bio_html_v < ?',
      )
      .all(MARKDOWN_VERSION)
    const setBio = db.query('UPDATE users SET bio_html = ?, bio_html_v = ? WHERE id = ?')
    for (const user of users) {
      setBio.run(user.bio ? renderMarkdown(user.bio, 'comment') : '', MARKDOWN_VERSION, user.id)
    }
    updated = items.length + comments.length + users.length
  })()
  return updated
}
