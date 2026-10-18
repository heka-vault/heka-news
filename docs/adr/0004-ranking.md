# 0004. Ranking: HN-style gravity

- Status: accepted
- Date: 2026-10-18

## Context

The front page should favor what members found worth a vote, and let new items rise and old ones
fall without anyone curating it.

## Decision

The front page orders items by Hacker News' published gravity formula:

```
score = (points - 1) / (age_hours + 2) ^ 1.8
```

- `points` starts at 1 (the author's own vote, as on HN), so a fresh item with no other votes
  scores 0 and ties are broken by newer first.
- `age_hours` is fractional hours since `created_at`.
- **Computed at read time in TypeScript** (`src/lib/rank.ts`, a pure function with unit tests),
  not in SQL. `src/db/items.ts` returns the candidates: the newest 500 live items
  (`RANK_CANDIDATES`). A count rather than an age window, so a quiet month never leaves the front
  page empty; gravity pushes old items down anyway. SQLite's `pow()` is available in our build,
  but keeping the formula out of SQL keeps it testable and keeps ADR 0002's portable-SQL rule.
- Deleted items never rank. Flags do not change the score yet; moderators act on flags and the
  action shows in the log. A flag penalty can be added to `rank.ts` later.
- `/newest`, `/posts`, `/status`, tag and user pages are reverse chronological.

## Consequences

- With a few hundred candidates the cost is a sort in memory per request, cached by the shared
  cache for 60 seconds. If an item older than the newest 500 ever deserves the front page, the
  site is busy enough to move the formula into SQL or precompute a score column.
