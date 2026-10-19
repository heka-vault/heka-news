-- 0005_discord_links: a member's Discord account (ADR 0009).
--
-- One Discord account per member and one member per Discord account. Linking never signs anyone
-- in; it lets replies in the Discord forum be carried here under the member's login. Only the
-- Discord user id and username are kept (scope `identify`); no OAuth token is stored.

CREATE TABLE IF NOT EXISTS discord_links (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id),
  discord_id  TEXT NOT NULL UNIQUE CHECK (length(discord_id) BETWEEN 1 AND 32),
  username    TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 64),
  linked_at   INTEGER NOT NULL
);
