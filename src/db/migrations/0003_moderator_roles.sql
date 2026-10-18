-- 0003_moderator_roles: moderators can make other members moderators, and remove them (ADR 0003).
--
-- The moderation log gains two actions, promote_moderator and remove_moderator. A CHECK cannot be
-- altered in place, so the table is rebuilt as in 0002, keeping every row, its id and the index.
-- migrate() runs this file and records it in one transaction, so it applies whole or not at all.

CREATE TABLE IF NOT EXISTS mod_log_next (
  id              INTEGER PRIMARY KEY,
  moderator_id    INTEGER NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL CHECK (action IN (
                    'delete_item', 'restore_item', 'edit_item', 'retag_item',
                    'delete_comment', 'restore_comment',
                    'ban_user', 'unban_user', 'revoke_invite',
                    'create_tag', 'dismiss_flags',
                    'promote_moderator', 'remove_moderator')),
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
