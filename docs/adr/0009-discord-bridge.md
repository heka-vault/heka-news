# 0009. The Discord bridge: linked accounts, forum threads and a relay bot

- Status: accepted
- Date: 2026-10-19

## Context

Much of the conversation among the people who read heka news happens on Discord. We want each item
to have a thread in a Discord forum, `#heka-news-threads`, and replies in that thread to become
comments here, so the discussion is in one place whichever side people use. Three constraints shape
it:

- **The web of trust (ADR 0003).** Every comment here belongs to an invited member with a public
  login. A Discord account alone is not a member.
- **One process writes the database (ADR 0002).** A bot holding a Discord gateway connection is a
  second, always-on process; it must not open the SQLite file.
- **Every state change is checked (ADR 0007).** Same validation, same rate limits, wherever a
  comment comes from.

## Decision

The bridge is a router. Nothing in it writes text of its own or uses a model.

**Linking.** A signed-in member connects a Discord account from `/settings`
(`src/routes/discord.tsx`). Discord's OAuth web flow with scope `identify` only; the access token
reads the user once and is revoked. The signed state carries a nonce, also set in a cookie, and
the member who started, so the callback completes only in that browser for that member. One Discord
account per member and one member per Discord account (`discord_links`). Linking is never a way to
sign in, and being in the Discord server gives no account here. The link is public: the profile
shows the Discord username. Disconnecting deletes the row; comments already carried stay under the
member's login.

**Out to Discord: the site posts, through a webhook.** A webhook on a forum channel can open a post
(`thread_name`) and write into an existing one (`thread_id`) under any name and avatar. So heka news
does the outbound half itself (`src/lib/outbox.ts`), with no gateway connection:

- A new item (link, post or status) opens a forum post: the title, the domain or an excerpt, who
  posted it, its tags, and a link here. Items from before the bridge get no thread.
- A comment made here is posted into the item's thread under the member's login and avatar, with
  the first line of the parent quoted when it is a reply, cut at 2,000 characters with a link to
  the rest.
- Edits and deletions here edit or delete those webhook messages; a retitled or retagged item
  updates its first message and renames its thread; an item that is removed or deleted gets a closing
  message and its thread is locked and archived, and a restored one is reopened.

A webhook cannot rename, lock or archive a thread, so for those three calls heka news also holds
the bot's token (`DISCORD_BOT_TOKEN`), and the bot is invited with Manage Threads. Without the token
those steps are skipped and the rest still works.

Outbound work goes into an outbox table (`discord_outbox`) and is sent by the same process right
after the response, and every minute for retries, so a Discord outage never slows a page or loses a
message. The queue is strictly first in, first out: it stops at the first row waiting for a retry,
so a comment never goes out before its thread exists. A row names what changed, and the message is
built from the rows when it is sent, so a comment edited and deleted before Discord saw it goes out
once, as a deletion. Discord refusing a request (4xx other than 429) drops it; anything else is
retried with backoff, eight times at most.

**In from Discord: a relay bot.** A separate service holds the gateway connection and keeps no
state. For each message created, edited or deleted in a bridged thread it calls
`POST /api/discord/events` here (`src/routes/bridge.ts`) with a bearer token
(`DISCORD_BRIDGE_TOKEN`); the endpoint answers 404 when the token is not configured. It turns
mentions, emoji and attachments into text before sending. The answer tells it what to do on
Discord: `carried`, `unlinked` (with `nudge` the first time), `refused` (with a `reason`, and
`notify` unless the member is banned), `ignored` or `duplicate`. heka news resolves the member from `discord_links`, the item
from the thread, and the parent comment from the replied-to message, then applies the same
validation and the same hourly comment limit as the comment form, and stores the comment marked
"via Discord".

- Only linked members' messages are carried. Others get a 🔗 reaction and, once, a direct message
  saying how to connect. A refused message (too long, over the limit, item locked) gets a ⚠️ and a
  direct message with the reason; a banned member's gets the reaction only.
- An edit within the edit window (`RULES.editWindow`) updates the comment; later edits stay on
  Discord. Deleting the message deletes the comment, leaving replies under "[deleted]".
- Each Discord message is carried at most once (a unique message id), so the bot can replay safely.
  On reconnect it asks `GET /api/discord/threads?since=` for the threads active in the last 14 days
  and the newest message carried in each, and replays what it missed.
- Nothing here deletes a message a person wrote on Discord; the server's own moderators handle
  Discord.
- Messages from webhooks are ignored, which is what keeps the two halves from echoing each other.

Votes, reactions and tags are not synced.

## Consequences

- A second way in for comments, through an endpoint that is not a browser form. It is not covered
  by `guardPost` (no session, no CSRF); the bearer token stands in for both, and everything after
  authentication goes through the same functions as the form.
- The database keeps one writer. The bot can be redeployed, restarted or replaced without touching
  it, and missing a few minutes of Discord costs nothing.
- New secrets in Heka Vault: `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` (linking),
  `DISCORD_FORUM_WEBHOOK` and `DISCORD_BOT_TOKEN` (outbound) and `DISCORD_BRIDGE_TOKEN` (inbound).
  Each part stays off until its values are set. Items posted before the webhook is set never get a
  thread.
- Members' words written on Discord are published here. The settings page says so before anyone
  connects.
