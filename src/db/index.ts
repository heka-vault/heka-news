// The only file that imports bun:sqlite (ADR 0002). Opens the database, sets the pragmas and
// applies migrations. Every query lives in a sibling module behind a named function.

import { Database } from 'bun:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Db = Database

const MIGRATIONS_DIR = join(import.meta.dir, 'migrations')

/** Open (creating if needed) the database at `path`, or in memory for ":memory:", and migrate it. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true, strict: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA synchronous = NORMAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

/** Apply every migration in src/db/migrations that has not run yet, in file-name order. */
export function migrate(db: Db): string[] {
  db.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const done = new Set(
    db
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  )
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name))
    .sort()
  const applied: string[] = []
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (done.has(version)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    db.transaction(() => {
      db.run(sql)
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        version,
        Math.floor(Date.now() / 1000),
      ])
    })()
    applied.push(version)
  }
  return applied
}

/** True when the database answers a trivial query. */
export function ping(db: Db): boolean {
  return db.query<{ ok: number }, []>('SELECT 1 AS ok').get()?.ok === 1
}
