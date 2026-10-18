# Design plan

Written before the first line of UI code, per `.agents/skills/frontend-design`, then checked
against that skill's list of AI-generated defaults and revised. The revisions are recorded at the
end, with what changed and why. Change this file deliberately, in its own commit, and re-run the
check when you do.

heka news is a sibling of hekafactory.com. The palette, the two typefaces and the mark come from
that site unchanged (`src/styles/tokens.css` is a copy of its tokens, with a few additions for a
dense list). What differs is the job: hekafactory.com sells a practice on a handful of pages; this
site is read in two modes, scanning a list of thirty items and then reading one long post.

## Grounding

- **Subject:** what engineers who build the harness around coding agents are reading, writing and
  shipping. Links to primary sources, long posts that live only here, and short status notes.
- **Audience:** heka's engineers and the people they invite (who post), and anyone else (who
  reads, often arriving from a search or a shared link to one post).
- **Job:** let a reader scan the front page in seconds and pick one item; then let them read a
  2,000-word post without fighting the page. Second job: make it obvious who is behind it and
  how someone gets in (invitation, a public invite tree, a public moderation log).
- **Material:** the sibling's factory floor, narrowed to one object: the tally sheet on a shift
  board. A count of marks, each one a person's. The heka mark is a tally whose tall violet bar is
  "the change a person read"; here an upvote is literally that mark, a person's stamp on an item.

## Color

The sibling's palette, with each color keeping its one job.

| Name | Light | Dark | Role here |
|---|---|---|---|
| Floor | `#eef0eb` | `#0f1916` | Page background; `--bg-raised` behind the comment band |
| Ink | `#16291f` | `#e3eae5` | Titles and text; muted meta is `#4a5b53` / `#a2b3aa` |
| Machine green | `#1f4235` | `#1b3a2f` | The site bar at the top of every page. The one bold surface |
| Lane yellow | `#f2c744` on green, `#7a5800` on the floor | `#f2c744`, `#e9c24a` | Rank numerals on the front page (a real sequence) and the current-page underline in the bar |
| Stamp violet | `#5638b8` | `#b8a4ff` | Links, focus, and the vote mark: the one mark a person makes |

## Type

- **Archivo** (variable width and weight) for the wordmark, item titles in lists, navigation,
  meta lines and headings. List titles at normal width, 600, 16–18px: dense but not cramped.
  Page and post headings wide (118%) and heavy, as on the sibling.
- **Source Serif 4** (variable optical size) for everything a person wrote: status notes, link
  text, post bodies, comments, bios. Post bodies at 18px on phones and 21px from 60rem, line
  height 1.6, measure capped near 66 characters.
- No monospace face is loaded; code uses the platform's. Counts use tabular figures.
- **Differences from the sibling, for speed** (found while getting Lighthouse to 100 on a
  throttled phone): Source Serif 4 is loaded from its weight-only files (50 KB for Latin) instead
  of the optical-size ones (120 KB); every serif here is reading text at 16–21px, where the optical
  axis barely moves. Faces use `font-display: optional` with the regular faces preloaded, so text
  never waits on a font and never re-flows when one lands. Blockquotes are upright (muted, with
  the violet rule) so a post page does not pull in a second 130 KB italic face for one quote.

## Layout

```
+---------------------------------------------------------------+
|## ||| heka news   Front  New  Posts  Status          Sign in ##|  machine-green bar
+---------------------------------------------------------------+
|  1  [|]  Guides are easy, sensors are the job (example.com)    |
|      128  quietfox 3 hours ago   42 comments   harness  agents  |
|  2  [|]  A status note runs straight into the list in serif,  |
|      9    without a title, two or three lines at most…         |
|  ...                                                           |
|  Older items                                                   |
|...............................................................|
|  About  Invite tree  Moderation log  RSS  hekafactory.com      |
+---------------------------------------------------------------+
```

- **The row.** Rank (front page only, lane-ink numerals), then a vote column (the tally bar over
  the point count, Lobsters-style, so the eye can run down the counts), then the title line and
  one meta line. Link rows show the domain; post rows say "post" and the reading time; status
  rows have no title and show their text in serif, clamped to three lines with the item page as
  the way back to the full text.
- **The item page.** A link item: a wide heading, the domain, the meta line, optional text, then
  comments. A post: the reading view, a big wide heading, byline and reading time, the serif body
  at a comfortable measure, then comments on the raised band.
- **Comments.** Threaded, indented with one guide line per level, folded and unfolded with
  `<details>` so it works without JavaScript. Indentation stops growing after a few levels on
  narrow screens so a deep thread never squeezes the text into a column of single words.
- **Invite tree.** A plain nested list drawn with the guide lines the comments use.
- **Moderation log.** A table with a stacked layout on phones.
- Everything is left-aligned.

## Principles

1. Spend boldness once: the green bar. Everything below it is type, space and the violet mark.
2. Density comes from type and rhythm, not from rules: no hairline between rows.
3. Numbers only where there is a real sequence (front page ranks). Counts are tabular.
4. Meta reads as a phrase ("quietfox 3 hours ago", "42 comments"), never a string of separators.
5. Pages are complete server-rendered HTML; JavaScript improves interactions but never owns rendering. Motion only answers a person's
   action (press, fold) or bridges a navigation, and stops under reduced motion.
6. Worst-case data is the design input, not an afterthought: long titles, unbreakable URLs,
   right-to-left text, 0 and 10,000 points, fourteen levels of replies, empty lists.

## Motion (emil-design-eng, animate)

| Element | Gate | Purpose | Ingredients |
|---|---|---|---|
| Vote mark press | tens of times a session | feedback | `:active` scale 0.95, 120ms `--ease-out`; transition on `transform` only |
| Comment fold | occasional | state indication | `::details-content` height and opacity, 200ms `--ease-out`; instant under reduced motion |
| Page navigation | tens of times a session | prevent a jarring change | cross-document view transition: root crossfade 140ms; the bar stays put; the clicked title morphs into the item heading, 220ms `--ease-in-out` |

## Review against the defaults

Worked through "design an HN-style community site" as a generic prompt to see where it lands,
then compared:

1. **Broadsheet hairlines and dense newspaper columns** (default 3). The generic answer puts a
   1px rule between every row. Revised: no rules between rows; rows separate by space and by the
   rank and vote column. The one horizontal change is the raised comment band.
2. **Middle-dot meta strings** (default 5). "128 points · quietfox · 3h · 42 comments" is exactly
   what the generic answer produced. Revised: points sit under the vote mark; the meta line is
   "quietfox 3 hours ago" then "42 comments", separated by space.
3. **Monospace for small data labels** (default 5). A "hacker" site reaches for mono domains and
   counts. Revised: Archivo with tabular figures; no mono outside code.
4. **Rounded tag pills.** The generic tag is a filled rounded chip. Revised: tags are plain links
   with a hairline outline and 1px corners, closer to a paper tag wired to a part.
5. **A clone of HN's orange bar.** The bar is the sibling's hero panel color, not a borrowed
   accent, so the family resemblance shows on the first pixel. Kept, with the wordmark set as on
   hekafactory.com.
6. **Cream background, serif display, terracotta** (default 1) and **near-black with one acid
   accent** (default 2): not used; the palette is the sibling's floor, green and violet.
7. **Fade-and-slide-up entrances** on each row: not used. No motion runs on load.

## Reviews while building (2026-10-18)

### Motion (emil-design-eng, animate, review-animations)

| Before | After | Why |
|---|---|---|
| Vote mark with no press state | `:active` scale 0.95 over 120ms `--ease-out`, plus a violet fill | Pressables must answer the press; on a 10px glyph the fill carries what the scale cannot |
| Fold opening and closing at 200ms | Open 200ms, close 140ms | The system answering a click is quicker than the reveal |
| Fold height animated everywhere | Height only without reduced motion; opacity always | Reduced motion means gentler, not none; height is the one tolerated non-transform property, for accordions |
| A slide on page navigation (the generic default) | A 140ms crossfade; the bar holds still; a post's title morphs into its heading in 220ms `--ease-in-out` | Navigation happens tens of times a session: near-imperceptible, with one spatial cue |
| Hover fills on every pointer | Hover gated to `(hover: hover) and (pointer: fine)` | Touch fires a hover on tap and leaves it stuck (mobile-native) |

No `transition: all`, no `scale(0)`, no `ease-in`, no keyframes on anything a person triggers.
`find-animation-opportunities` found nothing else worth moving: this is a reading site.

### Worst cases (break-ui)

The worst-case data lives in the seed permanently (`scripts/seed-data.ts`), so `bun run seed`
always shows it; there is no demo/worst toggle.

| # | Severity | Field | Worst case | What happened | Fix |
|---|---|---|---|---|---|
| 1 | Broken | post body | headings that start at `##` | First became `<h2>`, the rest `<h3>`: wrong outline | Shift relative to the post's own top level, never skip (`markdown.ts`) |
| 2 | Broken | comment with Arabic and English | one container with `dir="auto"` | The English sentence's punctuation flipped | `dir="auto"` on every block, set by the sanitizer |
| 3 | Ugly | reading view `###` | 18px heading over 21px body | Subheading smaller than its paragraph | `--text-reading-h2/-h3` tokens |
| 4 | Ugly | code in a post | `pre` at 14px, `code` at 0.875em of it | 12px code | `pre code { font-size: inherit }` |
| 5 | Ugly | table cells | "11 in a month" at 390px | Numbers broke across lines | `nowrap` on data cells inside a scroll container |
| 6 | Ugly | links in a meta row | 18px tall, 4px apart | Fails 24px target size | Inline-block with 3px padding |
| 7 | Fragile | `users.login`, `display_name` | no limit in the schema | Unbounded | `CHECK`: login 1–39 chars of GitHub's alphabet, name 1–80 |
| 8 | Fragile | status note | 501 characters | Rejected by the schema, as intended | Seed trimmed to exactly 500 |
| — | Holds | title | 160 characters with an unbreakable domain | Wraps; domain breaks anywhere | `overflow-wrap: anywhere` |
| — | Holds | points | 0 and 10,000 | "0" sinks to the bottom; "10,000" widens the vote column for every row, which stays aligned through the subgrid | — |
| — | Holds | thread | fourteen levels at 390px | Indentation shrinks after level 3 on phones; text keeps ~170px | `.c-children--deep` |
| — | Holds | counts | 1 point, 1 comment, 0 comments | "1 point", "1 comment", "discuss" | `plural()` |
| — | Holds | login | 35 characters | Wraps in meta, the tree and the profile heading | `overflow-wrap: anywhere` |
| — | Holds | lists | empty site, empty tag, member with nothing posted, empty log | Each has its own empty state | — |

### Guidelines (web-design-guidelines)

Fixed: a permalinked comment (`#c123`) now shows which one it is (`:target` tint);
`scroll-margin-top` on anchors; `translate="no"` on logins. Tried and reverted:
`content-visibility: auto` on long threads, because off-screen comments then fail hit-testing and
Lighthouse's target-size audit (revisit if threads reach hundreds of comments). Kept on purpose, against the generic rules: sentence case (brand, not
Title Case), "we" in the about page (brand voice), `theme-color` set to the bar's green rather
than the page background (it is the color at the top of the page), and `main:focus` without an
outline (the skip link's target, not a control).

### Screenshots

Three rounds against seed data, light and dark, 1280px and 390px. Round 1 found 3, 4 and the
heavy underlines on the invite tree; round 2 checked the fixes, the empty states and the gap
between the comment band and the footer.
