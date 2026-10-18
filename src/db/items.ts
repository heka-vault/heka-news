// Reading items: lists, one item, and the sitemap. All item SQL for reads lives here.

import type { Db } from './index.ts'
import type { ItemDetail, ItemKind, ItemSummary, RemovedBy, SitemapEntry } from './types.ts'

interface SummaryRow {
  id: number
  kind: ItemKind
  title: string | null
  url: string | null
  domain: string | null
  body_html: string | null
  body_chars: number
  author_id: number
  login: string
  display_name: string | null
  created_at: number
  points: number
  comment_count: number
}

// body_html only for status notes: lists show their text, never a post's body.
const SUMMARY_COLUMNS = `
  i.id, i.kind, i.title, i.url, i.domain,
  CASE WHEN i.kind = 'status' THEN i.body_html END AS body_html,
  length(i.body_md) AS body_chars, i.author_id,
  u.login, u.display_name, i.created_at, i.points, i.comment_count`

function tagsFor(db: Db, ids: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>()
  if (ids.length === 0) return map
  const rows = db
    .query<{ item_id: number; name: string }, number[]>(
      `SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
       WHERE it.item_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`,
    )
    .all(...ids)
  for (const row of rows) {
    const list = map.get(row.item_id) ?? []
    list.push(row.name)
    map.set(row.item_id, list)
  }
  return map
}

function toSummaries(db: Db, rows: SummaryRow[]): ItemSummary[] {
  const tags = tagsFor(
    db,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    domain: row.domain,
    bodyHtml: row.body_html,
    bodyChars: row.body_chars,
    authorId: row.author_id,
    author: { login: row.login, displayName: row.display_name },
    createdAt: row.created_at,
    points: row.points,
    commentCount: row.comment_count,
    tags: tags.get(row.id) ?? [],
  }))
}

/**
 * The newest `limit` live items: the candidates the front page ranks (ADR 0004). Items with
 * `flagThreshold` or more open flags stay off it until a moderator removes or keeps them.
 */
export function listRankCandidates(db: Db, limit: number, flagThreshold = 3): ItemSummary[] {
  const rows = db
    .query<SummaryRow, [number, number]>(
      `SELECT ${SUMMARY_COLUMNS} FROM items i JOIN users u ON u.id = i.author_id
       WHERE i.deleted = 0 AND i.flag_count < ? ORDER BY i.created_at DESC LIMIT ?`,
    )
    .all(flagThreshold, limit)
  return toSummaries(db, rows)
}

/** Live items, newest first, optionally of one kind. */
export function listNewest(
  db: Db,
  opts: { kind?: ItemKind; limit: number; offset: number },
): ItemSummary[] {
  const rows = opts.kind
    ? db
        .query<SummaryRow, [ItemKind, number, number]>(
          `SELECT ${SUMMARY_COLUMNS} FROM items i JOIN users u ON u.id = i.author_id
           WHERE i.kind = ? AND i.deleted = 0 ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(opts.kind, opts.limit, opts.offset)
    : db
        .query<SummaryRow, [number, number]>(
          `SELECT ${SUMMARY_COLUMNS} FROM items i JOIN users u ON u.id = i.author_id
           WHERE i.deleted = 0 ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(opts.limit, opts.offset)
  return toSummaries(db, rows)
}

/** Live items with a tag, newest first. */
export function listByTag(
  db: Db,
  tag: string,
  opts: { limit: number; offset: number },
): ItemSummary[] {
  const rows = db
    .query<SummaryRow, [string, number, number]>(
      `SELECT ${SUMMARY_COLUMNS} FROM items i
       JOIN users u ON u.id = i.author_id
       JOIN item_tags it ON it.item_id = i.id
       JOIN tags t ON t.id = it.tag_id
       WHERE t.name = ? AND i.deleted = 0 ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(tag, opts.limit, opts.offset)
  return toSummaries(db, rows)
}

/** A member's live items, newest first. */
export function listByAuthor(
  db: Db,
  login: string,
  opts: { limit: number; offset: number },
): ItemSummary[] {
  const rows = db
    .query<SummaryRow, [string, number, number]>(
      `SELECT ${SUMMARY_COLUMNS} FROM items i JOIN users u ON u.id = i.author_id
       WHERE u.login = ? AND i.deleted = 0 ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(login, opts.limit, opts.offset)
  return toSummaries(db, rows)
}

interface DetailRow extends SummaryRow {
  body_md: string
  full_html: string
  edited_at: number | null
  deleted: number
  deleted_at: number | null
  deleted_by: number | null
  flag_count: number
}

/** Author when the author deleted the row; moderator otherwise (including rows from before 0002). */
export function removedBy(row: {
  deleted: number
  deleted_by: number | null
  author_id: number
}): RemovedBy | null {
  if (row.deleted !== 1) return null
  return row.deleted_by === row.author_id ? 'author' : 'moderator'
}

/** One item by id, deleted or not; null if there is no such item. */
export function getItem(db: Db, id: number): ItemDetail | null {
  const row = db
    .query<DetailRow, [number]>(
      `SELECT ${SUMMARY_COLUMNS}, i.body_md, i.body_html AS full_html, i.edited_at,
              i.deleted, i.deleted_at, i.deleted_by, i.flag_count
       FROM items i JOIN users u ON u.id = i.author_id WHERE i.id = ?`,
    )
    .get(id)
  if (!row) return null
  const [summary] = toSummaries(db, [row])
  if (!summary) return null
  return {
    ...summary,
    bodyMd: row.body_md,
    bodyHtml: row.full_html,
    editedAt: row.edited_at,
    deleted: row.deleted === 1,
    deletedAt: row.deleted_at,
    removedBy: removedBy(row),
    flagCount: row.flag_count,
  }
}

/** Item summaries by id, deleted or not, in the order given. */
export function itemSummaries(db: Db, ids: number[]): ItemSummary[] {
  if (ids.length === 0) return []
  const rows = db
    .query<SummaryRow, number[]>(
      `SELECT ${SUMMARY_COLUMNS} FROM items i JOIN users u ON u.id = i.author_id
       WHERE i.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids)
  const byId = new Map(toSummaries(db, rows).map((item) => [item.id, item]))
  return ids.map((id) => byId.get(id)).filter((item): item is ItemSummary => item !== undefined)
}

/** Live links on a domain posted since `since`, newest first: candidates for a duplicate. */
export function recentLinksOnDomain(
  db: Db,
  domain: string,
  since: number,
): { id: number; url: string; title: string; createdAt: number }[] {
  return db
    .query<{ id: number; url: string; title: string; created_at: number }, [string, number]>(
      `SELECT id, url, title, created_at FROM items
       WHERE kind = 'link' AND deleted = 0 AND domain = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 200`,
    )
    .all(domain, since)
    .map((row) => ({ id: row.id, url: row.url, title: row.title, createdAt: row.created_at }))
}

/** Every live item's path and last change, for /sitemap.xml. */
export function listItemsForSitemap(db: Db, limit = 45000): SitemapEntry[] {
  return db
    .query<{ id: number; modified: number }, [number]>(
      `SELECT id, max(created_at, coalesce(edited_at, 0)) AS modified FROM items
       WHERE deleted = 0 ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ path: `/item/${row.id}`, lastModified: row.modified }))
}

/** Count of live items, optionally of one kind. */
export function countItems(db: Db, kind?: ItemKind): number {
  const row = kind
    ? db
        .query<{ n: number }, [ItemKind]>(
          'SELECT count(*) AS n FROM items WHERE deleted = 0 AND kind = ?',
        )
        .get(kind)
    : db.query<{ n: number }, []>('SELECT count(*) AS n FROM items WHERE deleted = 0').get()
  return row?.n ?? 0
}

/** Live items for a feed, newest first, with the full rendered body. */
export function listFeedItems(
  db: Db,
  opts: { tag?: string; limit: number },
): (ItemSummary & { fullHtml: string })[] {
  const rows = opts.tag
    ? db
        .query<SummaryRow & { full_html: string }, [string, number]>(
          `SELECT ${SUMMARY_COLUMNS}, i.body_html AS full_html FROM items i
           JOIN users u ON u.id = i.author_id
           JOIN item_tags it ON it.item_id = i.id
           JOIN tags t ON t.id = it.tag_id
           WHERE t.name = ? AND i.deleted = 0 ORDER BY i.created_at DESC LIMIT ?`,
        )
        .all(opts.tag, opts.limit)
    : db
        .query<SummaryRow & { full_html: string }, [number]>(
          `SELECT ${SUMMARY_COLUMNS}, i.body_html AS full_html FROM items i
           JOIN users u ON u.id = i.author_id
           WHERE i.deleted = 0 ORDER BY i.created_at DESC LIMIT ?`,
        )
        .all(opts.limit)
  const summaries = toSummaries(db, rows)
  return summaries.map((summary, i) => ({ ...summary, fullHtml: rows[i]?.full_html ?? '' }))
}
