# 0006. Three kinds of item: link, post, status

- Status: accepted
- Date: 2026-10-18

## Context

Big social sites are the lowest-common-denominator first hop. A second-hop site like HN carries a
sense of expertise, and people who want that come back to it. Members want to share three
different things: someone else's work, their own long-form writing, and a short note about what
they are doing.

## Decision

`items.kind` is one of:

| Kind | Title | URL | Body | List view | Item page |
|---|---|---|---|---|---|
| `link` | required, 1–160 chars | required, http(s) | optional markdown | title and domain | heading, domain, optional text, comments |
| `post` | required, 1–160 chars | none | required markdown | title, "post", reading time | the long-form reading view |
| `status` | none | none | required, 1–500 chars | the text itself, in serif | the text, comments |

- **Posts live only here**, not on hekafactory.com or social media, so they get a real reading
  layout: a wide measure-capped serif column, generous size, headings shifted under the page
  title.
- All three share points, comments, 1–3 tags, flags and moderation. The kind is enforced by
  `CHECK` constraints on `items`.
- `/posts` lists only posts, `/status` only status notes; the front page and `/newest` mix all
  three.
- Markdown for all kinds goes through one safe pipeline (`src/lib/markdown.ts`): no raw HTML,
  sanitized output, `rel="nofollow ugc noopener"` on links, no remote images.
- Structured data: `DiscussionForumPosting` for links and posts, `SocialMediaPosting` for status
  notes, comments as `Comment`.

## Consequences

- One table and one set of pages handle all three; the view switches on `kind`.
- A status note has no title, so its page title and `<h1>` use the start of its text.
