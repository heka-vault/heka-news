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

### Screenshots (phase 2)

Three rounds against seed data, light and dark, 1280px and 390px. Round 1 found 3, 4 and the
heavy underlines on the invite tree; round 2 checked the fixes, the empty states and the gap
between the comment band and the footer.


## Members' screens (phase 3, 2026-10-18)

Written before the CSS for sign-in, posting and moderation, then checked against the
frontend-design defaults like the rest of this plan. The reading pages do not change; these screens
are where a member *does* something, and they borrow the floor's one idea: a person's mark. The
tally mark stays the vote; a form is the work order a member fills in; a preview is a proof.

### What is new on the page

| Screen | Job | Layout |
|---|---|---|
| Bar, signed in | Get to posting and to your own page | "Submit" in the outlined slot "Sign in" used; your login beside it, cut with an ellipsis on phones (a 39-character login must not push the bar to three rows); "Replies" and, for moderators, "Mod" join the lists |
| `/submit` | Pick a kind, fill it in | Three kind tabs as links (`?kind=post`), each a labelled slot with a one-line hint on wide screens and the label only on phones; then the form for that kind in one column at the post measure |
| Comment form | Say something under an item | At the top of the raised band, a serif textarea on the floor colour so it reads as paper on the band; "Post comment" and "Preview" |
| Reply in place | Answer one comment without losing your place | The same form, opened under the comment's actions on the thread's guide line; Escape or Cancel closes an empty one and returns focus to "reply" |
| `/invite/:code` | Explain the site to someone who has never seen it, then let them in | A heading naming who invited them, a lede, the one solid button ("Sign in with GitHub"), and the expiry date. A used, expired or withdrawn link says which and what to do |
| `/settings` | Name, bio, invitations, sign out | One column of sections; a new invitation link appears once at the top in a stamped callout with a read-only field and "Copy link" |
| `/mod` | Act on flags, undo removals, revoke invitations, add tags | Sections in order of urgency; each flagged entry is the normal item row, a line of flag counts, and one reason field with two buttons (Remove, Keep) |
| Confirm pages | Delete your work, or act as a moderator | The thing quoted, one sentence on what happens, a reason field when the log will publish it, the button and Cancel |

### Form rules

- Labels above fields, in Archivo 600 at `--text-ui`. Hints under the label in muted caption, so a
  screen reader hears label, hint, then the field (`aria-describedby`).
- Inputs on `--bg-raised` (on the floor) or `--bg` (on the raised band), a 1.5px `--ink-muted`
  border, `--radius-control`, at least 16px text so phones do not zoom. Focus is the site's violet
  ring, nothing else.
- What a member writes is typed in the face it will be read in: serif textareas for bodies,
  comments and bios; Archivo for titles and addresses.
- Character limits come from the schema. A caption under the field says the limit; with JavaScript
  it counts down ("312 characters left") and turns stop-red when over.
- Errors: a summary at the top linking to each field, a message under the field, the field marked
  `aria-invalid`, and focus on the first one. What was typed is always kept.
- Buttons say what happens: "Post link", "Publish post", "Post note", "Post reply", "Save
  changes", "Make an invitation link", "Remove item". The sending state says it too ("Posting…").

### Color additions

| Name | Light | Dark | Role |
|---|---|---|---|
| Stop red | `#a3261c` | `#ff9d8a` | The red of a machine's emergency stop: error text, an over-limit count, and the outline of a button that removes or deletes. Never a fill behind text, never decoration. 6.4:1 on the floor in light, 8.9:1 in dark |

Everything else reuses the palette. Checked tags and the chosen kind tab take the violet stamp,
because choosing is a person's mark; the preview is outlined dashed, the idiom this site already
uses for something not live (the banned role).

### Motion (animate, then review-animations)

| Element | Gate | Purpose | Decision |
|---|---|---|---|
| Vote, pressed state | tens of times a session | feedback | No new motion. The existing press (scale 0.95, 120ms `--ease-out`) and the fill, which now stays when the vote is in; the fill transition is the same 120ms. The count changes without animation: it is data |
| Reply form opening in place | occasional | spatial consistency: it belongs to that comment | `@starting-style` from opacity 0 and 4px up, 200ms `--ease-out` (`--duration-fold`); opacity only under reduced motion |
| A reply just posted | occasional | state indication: here is yours | No motion. It takes the `:target` tint a permalinked comment gets, and focus moves to its author link |
| Preview appearing | occasional | none that motion serves | No animation: the panel appears where it was reserved under the field |
| Kind tabs, tag checkboxes, choices | tens of times | feedback | Colour and border only, `--duration` `ease`; press scale 0.97 on the tabs, which are links to another page |
| Form being sent | once per form | state indication | Text change on the button ("Posting…"), no spinner |

### Review against the defaults

1. **The SaaS-card form** (default 4): every field in a rounded white card with a soft shadow.
   Not used: fields sit on the page with labels above, no cards, no shadows. The only boxes are
   the preview (dashed, because it is a proof) and the new-invitation callout.
2. **Pill toggle for the kind of item.** The generic answer is a segmented control with a sliding
   thumb. Revised: three links with the kind's name and what it is for, because the choice
   changes the form's fields and deserves its own URL; the chosen one is stamped violet.
3. **Tag chips with an ×.** Revised: the tags look exactly like the tags on an item (paper labels,
   1px corners), so picking one previews how it will show.
4. **A red banner across the page for errors.** Revised: a quiet summary with a stop-red rule and
   links to the fields, and the message where the problem is.
5. **A modal for "Are you sure?"** Revised: a page. It works without JavaScript, it can be linked,
   and a moderator's reason field needs room.
6. **Toasts for "Saved".** Not used: the page you land on shows the result (the item, the comment
   in its thread, "Saved." above the profile form).

### Reviews while building (phase 3)

**Motion** (review-animations on the diff; verdict: approve)

| Before | After | Why |
|---|---|---|
| Reply form inserted with no transition | `@starting-style` opacity 0 and `translate: 0 -0.25rem`, 200ms `--ease-out` | Occasional, spatial: it belongs to the comment above; transform and opacity only, under 300ms |
| A pressed vote mark that only filled while held | Fill stays while `aria-pressed="true"`; same 120ms fill transition | State, not motion: the count is data and does not animate |
| Buttons without press feedback | `:active` scale 0.97, 120ms `--ease-out`, on `transform` only | Pressables answer the press; hover gated to fine pointers |
| A spinner while a form sends | The button's words change ("Posting…") | Once per form; a spinner would be motion with no information |

Under reduced motion every duration token is 0ms, so the reply form simply appears; that matches
the comment fold. No `transition: all`, no keyframes on anything a member triggers.

**Worst cases** (break-ui, against the seed, which now also has a flagged item, a flagged comment
and invitations in every state)

| # | Severity | Field | Worst case | What happened | Fix |
|---|---|---|---|---|---|
| 1 | Broken | login in the bar | `aleksandra-wisniewska-kowalczyk-ops` at 360px | Wordmark, login and "Submit" did not fit: the bar took three rows | Under 24rem the link says "You"; the login stays its accessible name |
| 2 | Broken | reply in place | the fourteenth level of a thread at 390px | A 150px textarea, one word per line | When the actions row is under 288px wide, "reply" opens the reply page |
| 3 | Ugly | moderator's lists | six lists at 360px | "Mod" wrapped onto its own row | The lists' gap tightens when there are five or more |
| 4 | Ugly | invitation note | 200 characters of German | "Withdraw" centred against seven lines | Top-aligned |
| 5 | Fragile | error copy | "should start with https://." | Doubled punctuation | "Paste the whole address, starting with https." |
| — | Holds | title, URL, body | 160 characters, unbreakable addresses, 501 characters | Wrap; counts and server limits agree with the schema | — |
| — | Holds | tags | four picked | The fourth is disabled with JavaScript and refused without it | — |
| — | Holds | mixed direction | Arabic and English in /replies | Each block finds its direction | — |
| — | Holds | empty states | no replies, no flags, no invitations, no tags | Each says what will appear | — |

**Guidelines** (web-design-guidelines): labels on every control, `aria-describedby` for hints,
counts and errors, `aria-invalid`, the first invalid field focused, placeholders ending in "…",
16px inputs, `autocomplete` set, live regions for previews and send errors, confirmation pages
before deleting, and a warning before leaving unsent writing (added after this review). Kept
against the generic rules, as before: sentence case, and the GitHub mark as the only icon.


## The invite tree, up front (2026-10-18)

Written before the code, per `frontend-design`, then checked against its defaults. The invite tree
is the thing this site has that other link sites do not: every member hangs under the person who
vouched for them, in public. Until now it was a footer link and a short "Tree" in the bar. This
section makes it a first-class part of the front page without taking the front page away from the
ranked list.

### The bar: "Invite tree", "Tree" only where it does not fit

The bar says "Invite tree", the page's own name. On phones the lists take their own row (seven
links for a moderator), so below a width that depends on how many links there are, the link shows
"Tree" instead. The full name stays in the link as visually hidden text and the short word is
`aria-hidden`, so a screen reader hears "Invite tree" once at every width. No JavaScript: the
breakpoints are counted with `:has(> li:nth-child(n))`, as the gaps already are.

Measured at 16px, weight 550 (Archivo; Liberation Sans standing in for Arial as the worst
fallback, about 4% wider):

| Bar | Links | Gap on phones | "Invite tree" from | Why there |
|---|---|---|---|---|
| Signed out | 5 | `--space-4` (was `--space-5`) | 21rem (336px) | 293px of links in the fallback face, 285px in Archivo; 360px leaves 320px |
| Member | 6 | `--space-3` | 24.25rem (388px) | 346px fallback, 336px Archivo |
| Moderator | 7 | `--space-2` | 25.5rem (408px) | 367px fallback, 356px Archivo |

Above 40rem the lists share the first row with the wordmark and always say "Invite tree". The
moderator bar at 360px keeps the 316px of links it has today (Archivo, "Tree"), one row.

### "Who's here" on the front page

**Job.** Show a reader, at a glance, that real people are here, who joined lately and who brought
them in, and lead them to the full tree. Second to the list, always.

**What it shows.**

- A heading, "Who's here".
- The five newest members (banned members are counted, never listed), grouped under the member
  who invited them, newest group first; founding members group under "Founding member". Each new
  member is their login, linked to their profile, then "joined 2 days ago" (the relative-time
  element every list uses, kept current by `src/client/time.ts` on cached pages). Each inviter
  is a muted link to their profile. Two levels at most, so a fourteen-deep chain never indents
  the panel; the depth is told in words instead.
- One sentence of size: "24 members so far." then, once anyone has been invited, "The longest
  chain of invitations is 4 people long." The count is the number `/tree` shows, banned members
  included, so the two never disagree. No count of founding members: they are the founding
  moderators, and the site gives no count of moderators.
- "See the whole invite tree", the one link out, at the foot.

**Where it sits.**

```
1280px                                                    390px
+---------------------------------------------------+     +-----------------------+
| bar                                               |     | bar                   |
+---------------------------------------------------+     +-----------------------+
|  1 [|] Title of the top item       | Who's here   |     |  1 [|] Title          |
|     128 quietfox 3 hours ago       |              |     |  ...                  |
|  2 [|] Second item                 | tinplate     |     | 30 [|] Title          |
|  ...                               | | jo  joined |     | Items 31 onward       |
|                                    | quietfox     |     |                       |
|                                    | | aleksandra |     | Who's here            |
|                                    | 24 members...|     | tinplate              |
|                                    | See the whole|     | | jo  joined 30 days  |
| 30 ...                             |   invite tree|     | 24 members so far...  |
| Items 31 onward                    |              |     | See the whole invite  |
+---------------------------------------------------+     +-----------------------+
```

- From 64rem, a 17rem column to the right of the list, top-aligned with the first item. At 1280px
  the list keeps about 770px, a comfortable measure for 18px titles; at 1024px it keeps 600px.
- Below 64rem, the same markup after the list and the pager, before the footer. It never sits
  above or between stories on a phone. In source order it always comes after the list, so a
  screen reader and the keyboard reach the stories first. It is an `<aside>` labelled by its
  heading.
- Page 1 of `/` only. Later pages and the other lists stay as they are.
- On an empty site (production on day one) it sits beside, or under, the "Nothing has been posted
  yet" state, and it is the proof that someone is already here.

**How it relates to the floor.** It is the shift board's roster beside the tally sheet: the list
counts marks, the panel names the people who make them. It is drawn with the tree's own idiom (the
nested list with one guide line per level that `/tree` and the comments use), so a reader who
opens `/tree` recognises it. No new color: inviters in muted ink, the new member in ink at 600, as
on `/tree`. No frame: it sits on the floor like everything else, separated by space and its
heading.

**Empty and small.** No members: "No members yet." and one sentence on how membership works, with
links to the about page and the tree. One member: their branch under "Founding member", "1 member
so far. Everyone else joins by invitation." (no chain sentence until someone has been invited).

**Cost.** Two small queries on page 1 of `/`: the five newest members joined to their inviters, and
a recursive count of the chain depth over `users_invited_by`. No script, no images. The page stays
public and cacheable for anonymous readers; nothing in the panel depends on who is looking.

### Review against the defaults

1. **The SaaS sidebar card** (default 4): a rounded box with a soft shadow and avatars. Not used:
   no frame, no shadow, no avatars (the site has none; a login is the identity, as on `/tree`).
2. **A big number with a small label** ("24 MEMBERS"). The generic answer leads with a stat. Not
   used: the count is a sentence at the foot, in caption size, after the people.
3. **A tally drawing of the member count.** Tempting, given the mark; rejected. It grows without
   limit and turns into decoration past a dozen marks. Counts use tabular figures (principle 3).
4. **An all-caps eyebrow** ("NEW MEMBERS") above the list (default 5). Not used: one sentence-case
   heading.
5. **"Members · 24 · 4 deep"** (middle-dot meta, default 5). Not used: the size reads as a phrase.
6. **A strip of avatars ("and 20 others").** Not used: it shows faces, not the tree, and the tree
   is the interesting part.
7. **A fade-in on load.** Not used: no motion runs on load.

### Reviews while building (the invite tree, up front)

Screenshots against the seed and three extra databases (no members; one founding member and no
items; the seed plus six members invited by one long login in one morning and an eight-member chain
under `bollard`), at 320, 390 and 1280px, light and dark; the bar measured at 320 to 1280px for
each role.

**Worst cases** (break-ui)

| # | Severity | Field | Worst case | What happened | Fix |
|---|---|---|---|---|---|
| 1 | Ugly | join time in the 17rem column | `aleksandra-wisniewska-kowalczyk-ops` among short logins | The long login pushed "joined…" to its own line while the others kept it inline: two row shapes in one list | From 64rem every join time takes its own line; on phones it stays inline |
| 2 | Ugly | empty site, 1280px | "Nothing has been posted yet" beside the panel | The empty state's top padding put its heading 32px below "Who's here" | No top padding on the empty state inside the two-column layout |
| 3 | Ugly | empty site, phones | the panel after the empty state | 80px of floor between them (the state's padding plus the panel's margin) | The panel drops its margin after an empty list |
| 4 | Fragile | banned member | `growth-hacker-9000` joined 12 days ago | Would be listed on the front page | Banned members are counted, never listed (`treeSummary`) |
| — | Holds | many in one morning | six from one inviter | They group under one inviter; five shown, the sixth is on `/tree` | — |
| — | Holds | deep chain | twelve people | The panel stays two levels deep; the sentence says "12 people long" | — |
| — | Holds | counts | 0, 1 and 32 members | "No members yet.", "1 member so far.", "32 members so far." | `plural()` |
| — | Holds | bar at 320px | member and moderator | The lists wrap to a second row with "Tree", no horizontal overflow; as before this change | — |

Just above 40rem (641px; two rows again by 700px) the bar still takes three rows for a moderator
(wordmark, then the lists, then "Submit" and the login). It did with "Tree" too; it is left for a
later pass on the bar.
