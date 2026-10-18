-- 0001_init: the schema for every phase (ADR 0002). Read-only pages use users, items, tags,
-- item_tags, comments and mod_log today; invites, sessions, votes and flags are for phase 3.
--
-- Times are Unix seconds. Counters on items and comments (points, comment_count, flag_count) are
-- denormalized and updated by the write functions in src/db/ in the same transaction as the vote,
-- comment or flag that changes them. Portable SQL only: no triggers, no custom functions.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  github_id     INTEGER UNIQUE,                      -- stable across GitHub renames
  -- GitHub login, shown and used in /u/:login. GitHub allows 39 characters: letters, digits, hyphens.
  login         TEXT NOT NULL UNIQUE COLLATE NOCASE
                CHECK (length(login) BETWEEN 1 AND 39 AND login NOT GLOB '*[^A-Za-z0-9-]*'),
  display_name  TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  bio           TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
  invited_by    INTEGER REFERENCES users(id),        -- NULL only for founding members
  created_at    INTEGER NOT NULL,
  is_moderator  INTEGER NOT NULL DEFAULT 0 CHECK (is_moderator IN (0, 1)),
  banned        INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  banned_at     INTEGER,
  banned_reason TEXT
);
CREATE INDEX IF NOT EXISTS users_invited_by ON users (invited_by);

-- One-time invitation links. Only the SHA-256 of the token is stored (ADR 0003).
CREATE TABLE IF NOT EXISTS invites (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  inviter_id  INTEGER NOT NULL REFERENCES users(id),
  note        TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  used_by     INTEGER UNIQUE REFERENCES users(id),
  used_at     INTEGER,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS invites_inviter ON invites (inviter_id);

-- Sessions: id is the SHA-256 of the cookie token.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- Items: link, post or status (ADR 0006).
CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('link', 'post', 'status')),
  title          TEXT,
  url            TEXT,
  domain         TEXT,                               -- host of url without "www.", for display
  body_md        TEXT NOT NULL DEFAULT '',
  body_html      TEXT NOT NULL DEFAULT '',           -- rendered by src/lib/markdown.ts
  body_html_v    INTEGER NOT NULL DEFAULT 0,         -- renderer version that produced body_html
  author_id      INTEGER NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  edited_at      INTEGER,
  points         INTEGER NOT NULL DEFAULT 1,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  flag_count     INTEGER NOT NULL DEFAULT 0,
  deleted        INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  deleted_at     INTEGER,
  CHECK (
    (kind = 'link'   AND title IS NOT NULL AND length(title) BETWEEN 1 AND 160
                     AND url IS NOT NULL AND length(url) <= 2000
                     AND length(body_md) <= 10000)
 OR (kind = 'post'   AND title IS NOT NULL AND length(title) BETWEEN 1 AND 160
                     AND url IS NULL AND length(body_md) BETWEEN 1 AND 100000)
 OR (kind = 'status' AND title IS NULL AND url IS NULL
                     AND length(body_md) BETWEEN 1 AND 500)
  )
);
-- Front page candidates and /newest: live items by time.
CREATE INDEX IF NOT EXISTS items_live_created ON items (deleted, created_at DESC);
-- /posts and /status.
CREATE INDEX IF NOT EXISTS items_kind_created ON items (kind, deleted, created_at DESC);
-- /u/:login.
CREATE INDEX IF NOT EXISTS items_author_created ON items (author_id, created_at DESC);
-- Duplicate-link checks (phase 3).
CREATE INDEX IF NOT EXISTS items_url ON items (url) WHERE url IS NOT NULL;

CREATE TABLE IF NOT EXISTS tags (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE CHECK (name GLOB '[a-z0-9]*' AND length(name) BETWEEN 1 AND 24),
  description  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- 1 to 3 tags per item; the cap is enforced in src/db/write.ts (no triggers, ADR 0002).
CREATE TABLE IF NOT EXISTS item_tags (
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (item_id, tag_id)
);
-- /t/:tag.
CREATE INDEX IF NOT EXISTS item_tags_tag ON item_tags (tag_id, item_id);

-- Threaded comments. path is the chain of ancestor ids, each zero-padded to 10 digits and joined
-- with '/', ending in the comment's own id: ordering by path walks the tree depth-first.
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  parent_id    INTEGER REFERENCES comments(id),
  author_id    INTEGER NOT NULL REFERENCES users(id),
  path         TEXT NOT NULL,
  depth        INTEGER NOT NULL DEFAULT 0,
  body_md      TEXT NOT NULL CHECK (length(body_md) BETWEEN 1 AND 10000),
  body_html    TEXT NOT NULL DEFAULT '',
  body_html_v  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  edited_at    INTEGER,
  points       INTEGER NOT NULL DEFAULT 1,
  flag_count   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS comments_item_path ON comments (item_id, path);
CREATE INDEX IF NOT EXISTS comments_author_created ON comments (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_parent ON comments (parent_id);

-- One vote per member per item or comment. Upvotes only.
CREATE TABLE IF NOT EXISTS item_votes (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS item_votes_item ON item_votes (item_id);

CREATE TABLE IF NOT EXISTS comment_votes (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comment_votes_comment ON comment_votes (comment_id);

-- Flags on an item or a comment (exactly one), one per member per target.
CREATE TABLE IF NOT EXISTS flags (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  item_id     INTEGER REFERENCES items(id) ON DELETE CASCADE,
  comment_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('off-topic', 'spam', 'unkind', 'duplicate', 'other')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  CHECK ((item_id IS NULL) <> (comment_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS flags_user_item ON flags (user_id, item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS flags_user_comment ON flags (user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS flags_open ON flags (resolved_at, created_at);

-- The public moderation log (/moderation). Every moderator action writes one row.
CREATE TABLE IF NOT EXISTS mod_log (
  id              INTEGER PRIMARY KEY,
  moderator_id    INTEGER NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL CHECK (action IN (
                    'delete_item', 'restore_item', 'edit_item', 'retag_item',
                    'delete_comment', 'restore_comment',
                    'ban_user', 'unban_user', 'revoke_invite')),
  item_id         INTEGER REFERENCES items(id),
  comment_id      INTEGER REFERENCES comments(id),
  subject_user_id INTEGER REFERENCES users(id),
  subject         TEXT NOT NULL DEFAULT '',          -- what was acted on, as shown at the time
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_log_created ON mod_log (created_at DESC);
