# 0007. Sessions, CSRF, invitations and rate limits

- Status: accepted
- Date: 2026-10-18
- Amends: 0003 (the details of sign-in), 0005 (CI secrets)

## Context

ADR 0003 chose GitHub sign-in, invitation links and SQLite sessions. Building them meant deciding
the parts it left open: how the OAuth flow is protected, how sessions live and die, how forms are
protected from other sites, what an invitation is, and how much one member can post. All of it has
to work with server-rendered pages, forms that post without JavaScript, and a cache switch that
keys off one cookie.

## Decision

### GitHub sign-in

- **An OAuth App, web flow, no scopes**: GitHub's public profile is all we read (numeric id,
  login, name, avatar URL). The callback is `/auth/github/callback`.
- **State is signed, not stored**: an HMAC (with `SESSION_SECRET`) over a nonce, the return path,
  an optional invitation code and an expiry ten minutes out. The nonce also goes in a short-lived
  `heka_oauth` cookie (path `/auth`, HttpOnly, SameSite=Lax); a callback whose state's nonce does
  not match the cookie is refused, so a flow only completes in the browser that started it.
- **PKCE (S256)**, which GitHub has supported for OAuth apps since July 2025. The verifier is an
  HMAC of the nonce, so it needs no storage and cannot be computed from the state alone.
- **The access token is never kept**: the code is exchanged server-side, the profile is read, and
  the token is revoked at GitHub (best effort) and dropped.
- **Who gets an account**: an existing member (matched by GitHub id; login renames follow); a login
  in `MODERATORS`, created as a root of the invite tree; or someone with an open invitation, created
  with `invited_by` set and the invitation marked used in the same transaction. Anyone else sees a
  page saying membership is by invitation, and nothing is created. Banned members are refused.
- **`users.is_moderator` mirrors `MODERATORS` at every GitHub sign-in**, so removing a login
  from the list demotes it at its next sign-in.
- **Without `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`** (and, in production, `SESSION_SECRET`)
  sign-in is closed: `/signin` says it opens soon, and nothing crashes.
- **Development sign-in**: `/dev/sign-in-as/:login` exists only when `NODE_ENV` is not
  `production` and no GitHub client id is set. The route is not registered otherwise, the handler
  checks again, and a test asserts both. The Docker image sets `NODE_ENV=production`.

### Sessions

- A random 256-bit token in the `heka_session` cookie: HttpOnly, SameSite=Lax, Path=/, Secure when
  `PUBLIC_URL` is https. The database stores only its SHA-256 (`sessions.id`).
- **30 days, sliding**: a request more than an hour after the session was last seen pushes the expiry
  another 30 days and re-sends the cookie. An expired or unknown cookie is cleared.
- **Rotated on sign-in**: any session the browser already had is deleted before the new one is made.
- **Signing out deletes the row.** Banning a member deletes all of their rows.
- The cache switch (ADR 0003) is unchanged: a request carrying `heka_session` is `private,
  no-store`, valid session or not, and every page that reads the session is personal.

### CSRF

Every state-changing request is a POST and passes two checks:

1. **Same origin**: `Sec-Fetch-Site`, when present, must be `same-origin`; `Origin`, when present,
   must equal `PUBLIC_URL`'s origin; at least one must be present.
2. **A per-session token**: `HMAC(SESSION_SECRET, "csrf", session id)`, in a hidden `csrf` field in
   every form and in the `X-CSRF-Token` header for `fetch` (read from a `<meta>` tag). It needs no
   storage, differs per session and dies with it.

Sign-out passes the same checks. SameSite=Lax on the session cookie is a third, independent layer.

### Invitations

- Any member can make one; there is no per-member limit for now. A code is 128 random bits
  (22 base64url characters), shown once on the page that made it; only its SHA-256 is stored.
- **Single use**, **14 days**, **revocable** by its maker (not logged: it is their own) or by a
  moderator (logged). An optional private note helps the maker remember who it was for; the
  invitee never sees it.
- `/invite/:code` explains the site and who sent the link, then offers "Sign in with GitHub". It
  is `no-store` and `noindex`. Banning a member revokes their open invitations.

### Rate limits

- Per member, per rolling hour, in one table (`rate_events`, pruned as rows age out): 10 items,
  60 comments, 300 votes, 30 flags, 300 previews. Over the limit is a 429 with `Retry-After` and a
  page that says what happened (JSON for `fetch`).
- No limit on invitations (above) or on edits, which are bounded by the two-hour window.

### What else this settled

- **Authors** may edit an item or comment for two hours, and delete it at any time. Deletion is
  soft; `deleted_by` (migration 0002) tells "deleted by its author" from "removed by a moderator".
  A link's URL never changes after posting.
- **Votes**: one per member per item or comment, never on your own, idempotent, and can be taken
  back. An item's first point is its author's (ADR 0004), shown as an already-filled mark.
- **Flags**: spam, off-topic or unkind; one per member per target, withdrawable until a moderator
  acts. An item with three open flags leaves the front page (it stays on `/newest` and its own
  page) until a moderator removes it or keeps it; either resolves its flags.
- **The moderation log gains two actions** (`create_tag`, `dismiss_flags`); the table was rebuilt
  in migration 0002 to widen its CHECK. Every moderator action requires a reason and writes the log
  in the same transaction.
- **Migration 0002 uses `ALTER TABLE ... ADD COLUMN`**, which has no `IF NOT EXISTS`. That is safe
  because `migrate()` applies a file and records it in one transaction.

## Consequences

- Production needs three secrets, all in Heka Vault project `heka-news`, environment `prod`:
  `SESSION_SECRET`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The deploy fetches them with a
  read key held by Woodpecker as `heka_vault_token` into a mode-600 env file that compose loads
  (`.woodpecker/scripts/deploy.sh`). That is the second CI secret, after `discord_webhook`; ADR
  0005's "the only CI secret" no longer holds.
- Rotating `SESSION_SECRET` invalidates every CSRF token and any sign-in in progress, but not the
  sessions themselves (their ids are plain hashes). Members reload the page and carry on.
- A shared cache in front of the site must not cache responses to requests carrying
  `heka_session`. Our headers say so (`private, no-store`, `Vary: Cookie`); a CDN rule that caches
  HTML regardless of headers would need a cookie bypass.
- One process writes, as before (ADR 0002). The rate-limit table adds a write per counted action.
