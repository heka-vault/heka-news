# 0001. Stack: Bun, Hono and server-rendered HTML

- Status: accepted
- Date: 2026-10-18

## Context

heka news is a list of links, posts and notes with comments. Almost every request is an anonymous
read, often from a search engine or a shared link. It has to be fast on a phone, readable without
JavaScript, and small enough that one person (or one agent) can hold the whole codebase in mind.
heka's other web projects already run on Bun.

## Decision

- **Runtime: Bun.** TypeScript runs without a build step, `bun:sqlite` is built in (ADR 0002), and
  `bun test` is the test runner.
- **HTTP: Hono.** Small, standard `Request`/`Response`, and it renders JSX to strings on the server
  (`hono/jsx`). No React, no hydration.
- **HTML is rendered on the server for every page.** There is no single-page app and no client
  framework. The site currently ships no JavaScript at all.
- **Progressive enhancement only.** Every page and every action works with JavaScript disabled:
  links are links, forms post, comment threads fold with `<details>`. JavaScript may be added
  later only to improve something that already works (for example, voting without a page
  reload), inline and small.
- **CSS is hand-written** against the sibling site's tokens, concatenated and fingerprinted at
  startup. Fonts are self-hosted from `@fontsource-variable/*`.

## Consequences

- No build step: `bun src/server.ts` is the production command, and the Docker image copies source.
- Lighthouse 100 in all four categories is achievable and is a gate (CLAUDE.md).
- Interactive features cost a form and a redirect, not a component. That is the intended price.
