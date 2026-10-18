-- 0002_members: what signing in, posting and moderating need beyond 0001 (ADR 0007).
--
-- ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite. That is safe here because migrate()
-- runs each file in one transaction and records it in the same transaction: the file applies
-- whole or not at all, and never twice.

-- GitHub's avatar URL, kept for later; pages load nothing from elsewhere, so it is not shown yet.
ALTER TABLE users ADD COLUMN avatar_url TEXT;
-- Bios are markdown now, rendered and cached like every other text a member writes.
ALTER TABLE users ADD COLUMN bio_html TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN bio_html_v INTEGER NOT NULL DEFAULT 0;

-- Who deleted a row: its author ("deleted") or a moderator ("removed"). NULL on rows deleted
-- before this migration, which were all removals by a moderator.
ALTER TABLE items ADD COLUMN deleted_by INTEGER REFERENCES users(id);
ALTER TABLE comments ADD COLUMN deleted_by INTEGER REFERENCES users(id);

-- Rate limits: one row per counted action, pruned as it ages out of the window.
CREATE TABLE IF NOT EXISTS rate_events (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_user ON rate_events (user_id, action, created_at);

-- Flags by target, for the moderator queue and for withdrawing a flag.
CREATE INDEX IF NOT EXISTS flags_item ON flags (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS flags_comment ON flags (comment_id) WHERE comment_id IS NOT NULL;
-- Replies to a member's items: top-level comments by item.
CREATE INDEX IF NOT EXISTS comments_item_created ON comments (item_id, created_at DESC);

-- The moderation log gains two actions: creating a tag, and keeping a flagged item or comment.
-- A CHECK cannot be altered in place, so the table is rebuilt with every row kept.
CREATE TABLE IF NOT EXISTS mod_log_next (
  id              INTEGER PRIMARY KEY,
  moderator_id    INTEGER NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL CHECK (action IN (
                    'delete_item', 'restore_item', 'edit_item', 'retag_item',
                    'delete_comment', 'restore_comment',
                    'ban_user', 'unban_user', 'revoke_invite',
                    'create_tag', 'dismiss_flags')),
  item_id         INTEGER REFERENCES items(id),
  comment_id      INTEGER REFERENCES comments(id),
  subject_user_id INTEGER REFERENCES users(id),
  subject         TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at      INTEGER NOT NULL
);
INSERT INTO mod_log_next (id, moderator_id, action, item_id, comment_id, subject_user_id, subject,
                          reason, created_at)
  SELECT id, moderator_id, action, item_id, comment_id, subject_user_id, subject, reason, created_at
  FROM mod_log;
DROP TABLE mod_log;
ALTER TABLE mod_log_next RENAME TO mod_log;
CREATE INDEX IF NOT EXISTS mod_log_created ON mod_log (created_at DESC);
