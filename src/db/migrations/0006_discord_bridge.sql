-- 0006_discord_bridge: forum threads, carried messages and the outbox (ADR 0009).
--
-- comments.source    'discord' for a comment carried in from the forum, shown "via Discord".
-- discord_threads    the forum post opened for an item. Items from before the bridge have none.
-- discord_messages   which Discord message is which comment, one row each. origin 'site' is the
--                    webhook copy of a comment written here; 'discord' is a message a member wrote
--                    on Discord. The primary key is what makes carrying a message idempotent.
-- discord_outbox     work for Discord, sent by this process after the response. A row names what
--                    changed; the message is built from the current rows when it is sent.
-- discord_nudges     Discord users who were told once how to connect their account.

ALTER TABLE comments ADD COLUMN source TEXT NOT NULL DEFAULT 'site'
  CHECK (source IN ('site', 'discord'));

CREATE TABLE IF NOT EXISTS discord_threads (
  item_id      INTEGER PRIMARY KEY REFERENCES items(id),
  thread_id    TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  -- The last time a message was carried either way; the bot replays threads active lately.
  active_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_messages (
  message_id  TEXT PRIMARY KEY,
  comment_id  INTEGER NOT NULL UNIQUE REFERENCES comments(id),
  thread_id   TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('site', 'discord')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS discord_messages_thread ON discord_messages (thread_id);

CREATE TABLE IF NOT EXISTS discord_outbox (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN (
                'item_created', 'item_updated', 'item_removed', 'item_restored',
                'comment_created', 'comment_updated', 'comment_deleted')),
  item_id     INTEGER REFERENCES items(id),
  comment_id  INTEGER REFERENCES comments(id),
  created_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_at     INTEGER NOT NULL,
  last_error  TEXT
);

CREATE TABLE IF NOT EXISTS discord_nudges (
  discord_id  TEXT PRIMARY KEY,
  nudged_at   INTEGER NOT NULL
);
