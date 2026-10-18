// Reading tags. All tag SQL for reads lives here.

import type { Db } from './index.ts'
import type { Tag } from './types.ts'

/** One tag with its live item count, or null. */
export function getTag(db: Db, name: string): Tag | null {
  const row = db
    .query<{ name: string; description: string; n: number }, [string]>(
      `SELECT t.name, t.description,
              (SELECT count(*) FROM item_tags it JOIN items i ON i.id = it.item_id
               WHERE it.tag_id = t.id AND i.deleted = 0) AS n
       FROM tags t WHERE t.name = ?`,
    )
    .get(name)
  return row ? { name: row.name, description: row.description, itemCount: row.n } : null
}

/** Every tag, alphabetically, with live item counts. */
export function listTags(db: Db): Tag[] {
  return db
    .query<{ name: string; description: string; n: number }, []>(
      `SELECT t.name, t.description,
              (SELECT count(*) FROM item_tags it JOIN items i ON i.id = it.item_id
               WHERE it.tag_id = t.id AND i.deleted = 0) AS n
       FROM tags t ORDER BY t.name`,
    )
    .all()
    .map((row) => ({ name: row.name, description: row.description, itemCount: row.n }))
}
