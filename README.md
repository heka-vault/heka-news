# heka news

The source of [news.hekafactory.com](https://news.hekafactory.com): a small, public news site
where engineers who build software with coding agents share links, long posts and short status
notes. Anyone can read it. Members post, comment and vote, and membership is by invitation, with
a public invite tree and a public moderation log. It is run by [heka](https://hekafactory.com).

## What is here

- Three kinds of item: **links** (title and URL), **posts** (long-form markdown, published only
  here) and **status notes** (up to 500 characters).
- A front page ranked by points and age, plus newest, posts, status, tag and member pages.
- Threaded comments that fold without JavaScript, RSS feeds, a sitemap and structured data.
- Sign-in with GitHub and invitation links are next; the database already has the tables.

The decisions behind it are short ADRs in [`docs/adr/`](docs/adr), and the visual design is in
[`docs/design-plan.md`](docs/design-plan.md).

## Stack

[Bun](https://bun.sh) and [Hono](https://hono.dev), with every page rendered on the server as
plain HTML. No client framework, and no JavaScript is sent to the browser. One SQLite file
(`bun:sqlite`) holds everything; all SQL lives in `src/db/`. Fonts are self-hosted Archivo and
Source Serif 4.

## Run it locally

```bash
bun install
bun run seed          # fictional seed data in ./data/heka-news.db
bun run dev           # http://localhost:8080
```

`PORT`, `DATABASE_PATH` and `PUBLIC_URL` change the defaults (see `src/config.ts`).

## Contributing

Pull requests are welcome. Before you open one:

```bash
bun run check         # types, lint, tests, and a smoke test against the real server
bun run lighthouse    # speed check: Lighthouse on key pages, mobile and desktop (needs Chrome)
```

Both must pass. [`CLAUDE.md`](CLAUDE.md) has the layout and the rules the code follows; it is
written for coding agents and works as well for people. The primary repository is on heka's own
forge and is mirrored here; pull requests opened on GitHub are carried across by a maintainer.

## License

MIT, © 2026 The Heka Vault, LLC. See [`LICENSE`](LICENSE). The vendored agent skills in
`.agents/skills/` keep their own licenses ([`VENDORED.md`](.agents/skills/VENDORED.md)).
