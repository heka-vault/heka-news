// Reading comments. All comment SQL for reads lives here.

import { excerpt, htmlToText } from '../lib/markdown.ts'
import type { Db } from './index.ts'
import { removedBy } from './items.ts'
import type { CommentDetail, CommentListing, CommentNode } from './types.ts'

interface CommentRow {
  id: number
  parent_id: number | null
  depth: number
  author_id: number
  login: string
  display_name: string | null
  created_at: number
  edited_at: number | null
  points: number
  body_html: string
  deleted: number
  deleted_by: number | null
}

const NODE_COLUMNS = `c.id, c.parent_id, c.depth, c.author_id, u.login, u.display_name, c.created_at,
  c.edited_at, c.points, c.body_html, c.deleted, c.deleted_by`

function toNode(row: CommentRow): CommentNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    depth: row.depth,
    authorId: row.author_id,
    author: { login: row.login, displayName: row.display_name },
    createdAt: row.created_at,
    editedAt: row.edited_at,
    points: row.points,
    bodyHtml: row.deleted ? '' : row.body_html,
    deleted: row.deleted === 1,
    removedBy: removedBy(row),
    children: [],
  }
}

/** Siblings sort by points, then oldest first, so a thread reads in the order it was written. */
function bySiblingOrder(a: CommentNode, b: CommentNode): number {
  return b.points - a.points || a.createdAt - b.createdAt || a.id - b.id
}

/**
 * The comment tree of an item. A deleted or removed comment keeps its place (and its replies) but
 * loses its text; one with no live replies is dropped.
 */
export function commentTree(db: Db, itemId: number): CommentNode[] {
  const rows = db
    .query<CommentRow, [number]>(
      `SELECT ${NODE_COLUMNS}
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.item_id = ? ORDER BY c.path`,
    )
    .all(itemId)

  const nodes = new Map<number, CommentNode>()
  const roots: CommentNode[] = []
  for (const row of rows) {
    const node = toNode(row)
    nodes.set(node.id, node)
    const parent = row.parent_id === null ? undefined : nodes.get(row.parent_id)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const prune = (list: CommentNode[]): CommentNode[] =>
    list
      .map((node) => ({ ...node, children: prune(node.children) }))
      .filter((node) => !node.deleted || node.children.length > 0)
      .sort(bySiblingOrder)
  return prune(roots)
}

/** One comment as a tree node with no children: a reply just posted, rendered on its own. */
export function commentNode(db: Db, id: number): CommentNode | null {
  const row = db
    .query<CommentRow, [number]>(
      `SELECT ${NODE_COLUMNS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
    )
    .get(id)
  return row ? toNode(row) : null
}

/** Number of live comments in a tree, counting replies. */
export function countTree(nodes: CommentNode[]): number {
  return nodes.reduce((n, node) => n + (node.deleted ? 0 : 1) + countTree(node.children), 0)
}

/** A short label for an item: its title, or the start of a status note. */
function itemLabel(title: string | null, bodyHtml: string): string {
  return title ?? excerpt(htmlToText(bodyHtml), 70)
}

/** One comment by id, deleted or not, with its item's title; null if there is none. */
export function getComment(db: Db, id: number): CommentDetail | null {
  const row = db
    .query<
      CommentRow & {
        item_id: number
        body_md: string
        raw_html: string
        item_title: string | null
        item_html: string
        item_deleted: number
      },
      [number]
    >(
      `SELECT ${NODE_COLUMNS}, c.item_id, c.body_md, c.body_html AS raw_html,
              i.title AS item_title, i.body_html AS item_html, i.deleted AS item_deleted
       FROM comments c JOIN users u ON u.id = c.author_id JOIN items i ON i.id = c.item_id
       WHERE c.id = ?`,
    )
    .get(id)
  if (!row) return null
  return {
    id: row.id,
    itemId: row.item_id,
    parentId: row.parent_id,
    depth: row.depth,
    authorId: row.author_id,
    author: { login: row.login, displayName: row.display_name },
    createdAt: row.created_at,
    editedAt: row.edited_at,
    points: row.points,
    bodyMd: row.body_md,
    bodyHtml: row.deleted ? '' : row.raw_html,
    deleted: row.deleted === 1,
    removedBy: removedBy(row),
    itemTitle: itemLabel(row.item_title, row.item_html),
    itemDeleted: row.item_deleted === 1,
  }
}

interface ListingRow {
  id: number
  item_id: number
  item_title: string | null
  item_html: string
  login: string
  display_name: string | null
  created_at: number
  points: number
  body_html: string
  parent_id: number | null
}

function toListing(row: ListingRow): CommentListing {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: itemLabel(row.item_title, row.item_html),
    author: { login: row.login, displayName: row.display_name },
    createdAt: row.created_at,
    points: row.points,
    bodyHtml: row.body_html,
    inReplyTo: row.parent_id === null ? 'item' : 'comment',
  }
}

const LISTING_COLUMNS = `c.id, c.item_id, i.title AS item_title, i.body_html AS item_html, u.login,
  u.display_name, c.created_at, c.points, c.body_html, c.parent_id`

/**
 * Replies to a member, newest first: comments on their live items that answer the item itself,
 * and replies to their comments. Their own comments, and deleted ones, are left out.
 */
export function listRepliesTo(
  db: Db,
  userId: number,
  opts: { limit: number; offset: number },
): CommentListing[] {
  return db
    .query<ListingRow, [number, number, number, number, number]>(
      `SELECT ${LISTING_COLUMNS}
       FROM comments c
       JOIN users u ON u.id = c.author_id
       JOIN items i ON i.id = c.item_id
       LEFT JOIN comments p ON p.id = c.parent_id
       WHERE c.deleted = 0 AND i.deleted = 0 AND c.author_id <> ?
         AND ((c.parent_id IS NULL AND i.author_id = ?) OR p.author_id = ?)
       ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, opts.limit, opts.offset)
    .map(toListing)
}

/** A member's live comments on live items, newest first. */
export function listCommentsByAuthor(
  db: Db,
  userId: number,
  opts: { limit: number; offset: number },
): CommentListing[] {
  return db
    .query<ListingRow, [number, number, number]>(
      `SELECT ${LISTING_COLUMNS}
       FROM comments c JOIN users u ON u.id = c.author_id JOIN items i ON i.id = c.item_id
       WHERE c.author_id = ? AND c.deleted = 0 AND i.deleted = 0
       ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    )
    .all(userId, opts.limit, opts.offset)
    .map(toListing)
}

/** Comment listings by id, for the moderator queue. */
export function commentListings(db: Db, ids: number[]): Map<number, CommentListing> {
  const map = new Map<number, CommentListing>()
  if (ids.length === 0) return map
  const rows = db
    .query<ListingRow, number[]>(
      `SELECT ${LISTING_COLUMNS}
       FROM comments c JOIN users u ON u.id = c.author_id JOIN items i ON i.id = c.item_id
       WHERE c.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids)
  for (const row of rows) map.set(row.id, toListing(row))
  return map
}
