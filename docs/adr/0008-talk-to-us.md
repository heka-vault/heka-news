# 0008. "Talk to us": conversation tokens and the post-call webhook

- Status: accepted
- Date: 2026-10-18

## Context

hekafactory.com gets a "Talk to us now" button: a visitor talks to an ElevenLabs agent that
speaks for heka, answers from the site's content, and passes a message to the team. hekafactory.com
is a static site with no server of its own, and an ElevenLabs agent can be reached three ways:

1. **ElevenLabs' widget on a public agent**, limited to our domain by an allowlist. One tag, but
   the script loads from a CDN onto every page, the look is theirs, and the allowlist only checks
   the Origin header, which anything outside a browser can set. Anyone with the agent id could
   spend our minutes.
2. **A link to ElevenLabs' hosted page for the agent.** No code; the visitor leaves the site.
3. **Our own button, an agent that requires authentication, and a server that hands out
   short-lived tokens.** The key stays on a server we run; we decide who gets a conversation and
   how many there are.

## Decision

Option 3, with heka news as the server, because it is already running, already fetches its
secrets from Heka Vault at deploy, and already has a rate limiter. Two JSON endpoints, neither tied
to a session (`src/routes/talk.ts`):

- **`POST /api/talk/token`.** Answers only an Origin in `TALK_ALLOWED_ORIGINS` (default
  `https://hekafactory.com`), with CORS for that origin and no credentials. It asks ElevenLabs for
  a WebRTC conversation token for `ELEVENLABS_AGENT_ID` with `ELEVENLABS_API_KEY` and returns
  `{ token }`. The token starts one conversation; the key never leaves the server and is never
  logged.
  - **Per visitor:** `TALK.perVisitorHour` (3) tokens an hour. A visitor is an HMAC of the address
    the Cloudflare tunnel reports (`CF-Connecting-IP`), so no IP address is stored.
  - **Per day:** `TALK_DAILY_LIMIT` (10) tokens per UTC day across all visitors. A token is
    reserved before ElevenLabs is asked and given back if none was issued, so simultaneous
    requests cannot pass the cap. The agent's own daily call limit in ElevenLabs is set to the same
    number, as a second cap that holds even if ours had a bug; the API key's credit quota is the
    monthly ceiling.
  - Errors are JSON for the button to explain: `origin` (403), `rate_limited` and `daily_limit`
    (429), `busy` (503, ElevenLabs over quota or concurrency), `upstream` (502), `disabled` (503,
    no key or agent configured, which is how development and previews run).
- **`POST /api/talk/webhook`.** ElevenLabs' post-call webhook. The `ElevenLabs-Signature` header is
  `t=<unix seconds>,v0=<hex HMAC-SHA256 of "<t>.<raw body>">` under `ELEVENLABS_WEBHOOK_SECRET`,
  the scheme `constructEvent` checks in the official `@elevenlabs/elevenlabs-js` SDK; we compare in
  constant time and refuse a signature more than 30 minutes old or ahead. The webhook is
  workspace-wide, so anything but a `post_call_transcription` for our agent is acknowledged and
  ignored. The summary and the collected fields go to a private Discord channel
  (`DISCORD_TALK_WEBHOOK`) with mentions and link previews off and visitor text escaped. A
  conversation is recorded as posted only once Discord accepts it; until then the endpoint answers
  500 and ElevenLabs retries, and a retry after success is not posted twice.

The agent's prompt, settings and knowledge base are in `docs/talk-agent.md` and
`docs/talk-knowledge-base.md`, reviewed like code and copied into the dashboard.

## Privacy

The visitor talks to an AI agent, and the button says so before the microphone turns on. Audio
goes to ElevenLabs, which transcribes it and runs the model. The agent records no audio; ElevenLabs
keeps transcripts for 30 days. We keep nothing but the summary and the details the visitor chose
to give, in a Discord channel only the people who reply can read, and the conversation id so a
retry is not posted twice. The token endpoint keeps an HMAC of the visitor's address for an hour.

## Consequences

- When heka news is down, the button cannot start a conversation and says so; the email address is
  still on the page.
- A new secret (`ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, `DISCORD_TALK_WEBHOOK`) arrives
  the same way as the others: Heka Vault `heka-news/prod`, fetched at deploy (ADR 0007).
- The limits are deliberately small. Raise `TALK_DAILY_LIMIT` and the agent's daily call limit
  together.
