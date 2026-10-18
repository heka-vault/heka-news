# heka news: agent operating manual

The source of news.hekafactory.com: a public news site where engineers who build software with
coding agents share **links**, long-form **posts** and short **status notes**. Anyone can read.
Members (heka's engineers and the people they invite) post, comment, vote and flag. The invite
tree and the moderation log are public. It is run by heka (hekafactory.com), a group of engineers
who build software factories; the firm is The Heka Vault, LLC.

This repository is **public** (MIT, mirrored to GitHub). Everything in it is read by strangers.

Before any non-trivial task, read:

1. `docs/adr/` for why things are the way they are (stack, storage, auth, ranking, open source,
   item kinds). Do not reverse an ADR in passing; write a new one that supersedes it.
2. `docs/design-plan.md` before any visual change. It is the plan the UI was built from.
3. `.agents/skills/VENDORED.md` for the design, motion and writing skills (the table at the end of
   this file says which applies when).

## Status

Phases 1 and 2 are done: decisions, the full schema, and a read-only site with seed data. Phase 3
adds GitHub sign-in, invitation links, posting, commenting, voting and flagging. Until then "Sign
in" leads to `/signin`, which explains that membership is by invitation and sign-in opens soon,
and vote marks link there too.

## Layout

| Path | What |
|---|---|
| `src/server.ts` | Process entry: open and migrate the database, re-render stale HTML, serve |
| `src/app.tsx` | `createApp({ db, config, clock })`: every route, plus response finishing |
| `src/config.ts` | `SITE` constants, `SESSION_COOKIE`, `PAGE_SIZE`, and `loadConfig()` from the environment |
| `src/db/index.ts` | The only file that imports `bun:sqlite`: `openDb()`, pragmas, `migrate()` |
| `src/db/migrations/` | Plain SQL, `NNNN_name.sql`, applied in order at startup. Never edit one that has shipped |
| `src/db/{items,comments,users,tags,modlog}.ts` | Read queries, one named function each |
| `src/db/write.ts` | Writes: users, tags, items, comments, moderation; keeps counters and cached HTML in step |
| `src/db/types.ts` | The shapes `src/db/` returns. Views depend on these, never on columns |
| `src/lib/markdown.ts` | The one markdown pipeline (markdown-it, then sanitize-html). `MARKDOWN_VERSION` |
| `src/lib/rank.ts` | The front page formula (ADR 0004) |
| `src/lib/http.ts` | Cache-Control switch, ETag/304, compression, security headers |
| `src/lib/jsonld.ts`, `src/lib/feeds.ts` | Structured data; RSS, sitemap, robots.txt |
| `src/lib/assets.ts` | Builds the inline stylesheet and the font routes at startup |
| `src/lib/format.ts` | Numbers, plurals, relative times, domains |
| `src/views/` | Hono JSX: `components/` (Layout, Items, Comments, Mark, Time) and `pages/` |
| `src/styles/` | `tokens.css` (from hekafactory.com, plus additions), `base.css`, `app.css` |
| `public/` | Favicon, touch icon, `og.png` (`sh scripts/render-assets.sh` re-renders it) |
| `scripts/` | `seed.ts` and `seed-data.ts`, `smoke.ts`, `lighthouse.ts`, `serve-seeded.ts`, `screenshots.sh` |
| `test/` | `bun test`: ranking, markdown (XSS), HTTP caching, database, routes |
| `Dockerfile`, `deploy/prod/compose.yaml`, `.woodpecker/` | The image, the production stack, CI and CD |

## Commands

```bash
bun install                  # commit bun.lock; never bun.lockb
bun run seed                 # seed ./data/heka-news.db (add -- --reset to start over)
bun run dev                  # http://localhost:8080, restarts on change
bun run check                # the PR gate: tsc, biome ci, bun test, smoke. Green before every push
bun run lighthouse           # speed check (not a gate): /, a post and a profile, mobile
                             # and desktop. Needs Chrome (CHROME_PATH). LIGHTHOUSE_PRESETS=mobile
                             # runs one form factor while you iterate
bun run shots                # screenshots of key pages, light, dark and 390px, into ./shots/
bun run format               # biome format --write
docker build --build-arg GIT_SHA="$(git rev-parse HEAD)" -t heka-news .
```

## Rules

- **All SQL lives in `src/db/`.** Routes, views and libraries call named functions; they never
  see a `Database` or a SQL string. Portable SQL only (ADR 0002): no triggers, no extensions, no
  custom functions, so the engine can become Turso without touching anything outside `src/db/`.
- **Schema changes are new migration files.** Never edit a migration that has run anywhere. Make
  statements re-runnable (`IF NOT EXISTS`).
- **Server-rendered pages, not a single-page app.** Every URL returns complete HTML from the
  server, and there is no client framework or client-side router. JavaScript is welcome where it
  makes the site better (voting without a reload, replying in place, a markdown preview, live
  relative times): plain modules served from this origin as files, loaded per feature, with no
  inline script and no inline handlers (the CSP allows `script-src 'self'` only, and a test checks
  the markup). Reading must still work if a script fails to load.
- **Pages load fast.** That is the goal; Lighthouse is how we check it, not a gate. Run
  `bun run lighthouse` before UI pull requests and note the scores; a big drop needs a reason.
  Things that cost speed before: a linked stylesheet (now inline), a 130 KB italic face for one
  blockquote, 18px-tall links in a row (axe target-size), a CSP without `connect-src`
  (Lighthouse could not read robots.txt).
- **Everything a member writes goes through `renderMarkdown()`** and is cached in `body_html`. Do
  not render user text any other way. Changing the pipeline's output means bumping
  `MARKDOWN_VERSION`; every row is re-rendered at the next start. Outbound user links carry
  `rel="nofollow ugc noopener"`.
- **Cache headers:** anonymous GETs are `public, max-age=0, s-maxage=60,
  stale-while-revalidate=300`; any request carrying the `heka_session` cookie gets `private,
  no-store` (`src/lib/http.ts`). A personalized response must never be served from a shared
  cache, so never set a public Cache-Control on a route that reads the session.
- **Tokens only.** No hex values, font names or pixel sizes in components or `app.css`; use the
  custom properties in `tokens.css`. The values shared with hekafactory.com are changed there
  first, then copied here.
- **Accessible by default.** One `<h1>` per page, visible focus, WCAG AA contrast in light and
  dark (ratios at the top of `tokens.css`), 24px targets for links in rows, `dir="auto"` on
  anything a member wrote, nothing that moves under `prefers-reduced-motion`. Check 360px wide.
- **Light and dark are both first-class.** The site follows `prefers-color-scheme`; there is no
  toggle.
- **Seed data is for development only.** `scripts/` is not in the Docker image, and `seed.ts`
  refuses `NODE_ENV=production`. Production starts empty; the empty states are designed. Seed
  handles are fictional; never put a real person in the seed.
- **This repository is public.** No hostnames, IP addresses, internal machine or project names,
  tokens or private URLs anywhere, except the registry address and stack path in `.woodpecker/`
  and `deploy/`. No secrets, ever: the only CI secret (`discord_webhook`) lives in Woodpecker.

## Words

Every word a visitor reads follows heka's voice (hekafactory.com's brand guide): senior, plain,
direct, slightly dry. "We" is heka. Sentence case. Short sentences, concrete nouns. Go easy on em
dashes. Buttons and links say what happens. Empty states say what will appear and how to take
part; errors say what happened. Never: AI-powered, AI-native, 10x, unlock, leverage (as a verb),
revolutionize, seamless, cutting-edge, supercharge, empower, "the future of". Run the
`humanizer` skill on new copy, against the voice rules in this section. Name no members of the
group on the site; moderators are "three of us".

## Which skill applies

| When | Skill |
|---|---|
| A new page or a visual change | `frontend-design`: update `docs/design-plan.md`, check it against the defaults list, then build |
| Anything in `src/styles/` | `better-typography` |
| Anything a person presses or folds | `emil-design-eng` (review), `mobile-native` (tap, hover, targets) |
| Adding or changing motion | `animate` first (its gate usually says no), then `review-animations`; `animation-performance` if it drops frames |
| How an item, comment or member renders | `break-ui`, against the worst cases already in the seed |
| Any copy | `humanizer`, against the voice rules under Words |
| Before the PR for any UI change | `web-design-guidelines` |

## Deploy

`main` is production. A push to `main` runs `.woodpecker/deploy.yaml`: build the image tagged with
the commit and push it to the LAN registry, copy `deploy/prod/compose.yaml` to the stack
directory, write `TAG`, pull and recreate, and fail unless the container's `/healthz` (checked
with `compose exec ... bun -e`, since the slim image has no wget) reports the commit. Then it
checks `https://news.hekafactory.com/healthz` and only warns on a mismatch, prunes, and posts to
Discord. A Cloudflare tunnel forwards the domain to `127.0.0.1:3311`. The database is
`data/heka-news.db` beside the compose file; it is never in the image.

Pull requests to `main` run `.woodpecker/ci.yaml` (`bun run check`). Work happens on branches and
merges by pull request on Forgejo; GitHub is a push mirror. Never force-push `main`.
