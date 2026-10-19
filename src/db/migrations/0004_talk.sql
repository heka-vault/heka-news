-- 0004_talk: "Talk to us" on hekafactory.com (ADR 0008).
--
-- talk_visitors  one row per conversation token a visitor took, for the hourly per-visitor limit.
--                The visitor is an HMAC of their IP address, never the address itself. Rows older
--                than the window are pruned whenever anyone asks for a token.
-- talk_days      tokens issued per UTC day, for the daily cap across all visitors.
-- talk_conversations  conversations whose summary reached Discord, so a retried webhook is not
--                posted twice.

CREATE TABLE IF NOT EXISTS talk_visitors (
  visitor     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS talk_visitors_visitor ON talk_visitors (visitor, created_at);

CREATE TABLE IF NOT EXISTS talk_days (
  day     TEXT PRIMARY KEY,
  tokens  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS talk_conversations (
  conversation_id  TEXT PRIMARY KEY,
  posted_at        INTEGER NOT NULL
);
