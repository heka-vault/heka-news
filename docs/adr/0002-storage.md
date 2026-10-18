# 0002. Storage: one SQLite file, all SQL in `src/db/`

- Status: accepted
- Date: 2026-10-18

## Context

The site is a single small community. Its data (users, items, comments, votes, flags, the
moderation log) fits comfortably in one SQLite file, and reads vastly outnumber writes. We want
backups to be a file copy and the database to need no separate server.

Turso, the Rust rewrite of SQLite, is file- and SQL-compatible and adds concurrent writes. Its 0.8
line is still beta as of October 2026, so we do not adopt it now, but we want switching to be a
change to one directory.

## Decision

- **`bun:sqlite`**, one file at `/data/heka-news.db` in production (`DATABASE_PATH`).
- **WAL mode**, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- **All SQL lives in `src/db/`**, behind small named functions (`listNewest`, `getItem`,
  `commentsForItem`, ...). Routes, views and libraries never see a `Database` method or a SQL
  string. `src/db/index.ts` is the only file that imports `bun:sqlite`.
- **Migrations are plain `.sql` files** in `src/db/migrations/`, named `NNNN_name.sql`, applied in
  order at startup inside a transaction and recorded in `schema_migrations`. A migration that has
  run is never edited; a change is a new file. Statements use `IF NOT EXISTS` so a half-applied
  file can be re-run.
- **Portable SQL only**: no custom functions (bun:sqlite cannot register them anyway), no
  extensions, no triggers. Rules that a trigger could enforce (at most three tags per item) are
  enforced in `src/db/` write functions.
- **Timestamps are Unix seconds** (`INTEGER`).
- **Denormalized counters** (`items.points`, `items.comment_count`) are updated in the same
  transaction as the vote or comment that changes them, so list pages never aggregate.
- **Rendered HTML is cached in the row** (`body_html`), with the renderer version in
  `body_html_v`; at startup, rows rendered by an older version are re-rendered.

## Consequences

- Backup is a consistent copy of one file (`sqlite3 .backup` or a WAL checkpoint and copy).
- One process writes. That is fine at this size; Turso would lift it.
- Swapping engines means rewriting `src/db/index.ts` and, at worst, a few statements in
  `src/db/*.ts`. Nothing else changes.
