// Reading comments. All comment SQL for reads lives here.

import type { Db } from './index.ts'
import type { CommentNode } from './types.ts'

interface CommentRow {
  id: number
  parent_id: number | null
  depth: number
  login: string
  display_name: string | null
  created_at: number
  points: number
  body_html: string
  deleted: number
}

/** Siblings sort by points, then oldest first, so a thread reads in the order it was written. */
function bySiblingOrder(a: CommentNode, b: CommentNode): number {
  return b.points - a.points || a.createdAt - b.createdAt || a.id - b.id
}

/**
 * The comment tree of an item. A removed comment keeps its place (and its replies) but loses its
 * text; a removed comment with no live replies is dropped.
 */
export function commentTree(db: Db, itemId: number): CommentNode[] {
  const rows = db
    .query<CommentRow, [number]>(
      `SELECT c.id, c.parent_id, c.depth, u.login, u.display_name, c.created_at, c.points,
              c.body_html, c.deleted
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.item_id = ? ORDER BY c.path`,
    )
    .all(itemId)

  const nodes = new Map<number, CommentNode>()
  const roots: CommentNode[] = []
  for (const row of rows) {
    const node: CommentNode = {
      id: row.id,
      parentId: row.parent_id,
      depth: row.depth,
      author: { login: row.login, displayName: row.display_name },
      createdAt: row.created_at,
      points: row.points,
      bodyHtml: row.deleted ? '' : row.body_html,
      deleted: row.deleted === 1,
      children: [],
    }
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

/** Number of live comments in a tree, counting replies. */
export function countTree(nodes: CommentNode[]): number {
  return nodes.reduce((n, node) => n + (node.deleted ? 0 : 1) + countTree(node.children), 0)
}
