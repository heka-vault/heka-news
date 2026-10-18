// The about page, the error pages, and a plain message page for refusals and confirmations.

import type { Child } from 'hono/jsx'
import { SITE } from '../../config.ts'
import type { RemovedBy } from '../../db/types.ts'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

export function AboutPage({
  ctx,
  tags,
}: {
  ctx: PageContext
  tags: { name: string; description: string }[]
}) {
  return (
    <Layout
      ctx={ctx}
      title="About"
      description="What heka news is, who runs it, and how membership by invitation works."
      canonical="/about"
    >
      <div class="wrap">
        <header class="page-head">
          <h1>About heka news</h1>
        </header>
        <div class="prose reading">
          <p>
            heka news is a news site for engineers who build software with coding agents. Members
            post links to primary sources, long posts of their own and short status notes. Anyone
            can read them; members also comment and vote.
          </p>
          <p>
            Long posts are written for this site and are not published anywhere else, including
            hekafactory.com and social media.
          </p>

          <h2>Who runs it</h2>
          <p>
            <a href={SITE.parent.url}>heka</a> runs it. We are a group of engineers who build
            software factories: the guides, checks, access and infrastructure that coding agents
            work in. Three of us moderate. Every moderator action is public, with its reason, in the{' '}
            <a href="/moderation">moderation log</a>.
          </p>

          <h2 id="membership">How membership works</h2>
          <p>
            Membership is by invitation. heka’s engineers are the first members, and any member can
            invite someone whose work they know. Who invited whom is public on the{' '}
            <a href="/tree">invite tree</a>, so every account can be traced back to the person who
            vouched for it.
          </p>
          <p>
            You sign in with GitHub. If a member has invited you, the link in your invitation
            creates your account; after that, <a href="/signin">sign in</a> from any page.
            {ctx.signin === 'closed' && ' Sign-in opens soon; until then the site is read-only.'}
          </p>
          <p>
            Members can post up to 10 items, 60 comments and 300 votes an hour. Authors can edit
            what they wrote for two hours and delete it at any time. An item that three members flag
            leaves the front page until a moderator looks at it.
          </p>

          <h2>What gets posted</h2>
          <p>
            A link is a title and a URL, ideally to the primary source, with optional text. A post
            is a member’s own long-form writing, with a title. A status note is up to 500 characters
            and has no title.
          </p>
          <p>Every item carries one to three tags:</p>
          <ul class="tag-list">
            {tags.map((tag) => (
              <li>
                <a href={`/t/${tag.name}`}>{tag.name}</a>
                {tag.description && `: ${tag.description}`}
              </li>
            ))}
          </ul>

          <h2>Ranking</h2>
          <p>
            The top list ranks by points and age, with the formula Hacker News published:{' '}
            <code>(points − 1) / (age in hours + 2)^1.8</code>. Every other list is newest first.
          </p>

          <h2>Feeds and source</h2>
          <p>
            Follow the <a href="/rss">RSS feed</a> of everything new, or the feed on any tag page.
            The site is open source under the MIT license; the code is on{' '}
            <a href={SITE.source}>GitHub</a>.
          </p>
        </div>
      </div>
    </Layout>
  )
}

/** A short page with a heading and a few paragraphs: refusals, limits, confirmations. */
export function MessagePage(props: {
  ctx: PageContext
  title: string
  heading?: string
  children: Child
  description?: string
}) {
  return (
    <Layout
      ctx={props.ctx}
      title={props.title}
      description={props.description ?? props.title}
      noindex
    >
      <div class="wrap">
        <header class="page-head">
          <h1>{props.heading ?? props.title}</h1>
        </header>
        <div class="prose reading message">{props.children}</div>
      </div>
    </Layout>
  )
}

export function ErrorPage(props: {
  ctx: PageContext
  status: 404 | 410
  removedBy?: RemovedBy | null
  /** Shown under the explanation on a 410 (a moderator's restore form). */
  children?: Child
}) {
  const gone = props.status === 410
  const byAuthor = props.removedBy === 'author'
  return (
    <Layout
      ctx={props.ctx}
      title={gone ? (byAuthor ? 'Deleted' : 'Removed') : 'Not found'}
      description={
        gone
          ? byAuthor
            ? 'The author deleted this item.'
            : 'A moderator removed this item.'
          : 'There is no page at this address.'
      }
      noindex
    >
      <div class="wrap">
        <header class="page-head">
          <h1>
            {gone
              ? byAuthor
                ? 'This item was deleted'
                : 'This item was removed'
              : 'Nothing at this address'}
          </h1>
        </header>
        <div class="prose reading">
          {gone ? (
            byAuthor ? (
              <p>Its author deleted it.</p>
            ) : (
              <p>
                A moderator removed it. The reason is in the{' '}
                <a href="/moderation">moderation log</a>.
              </p>
            )
          ) : (
            <p>
              The link may be mistyped, or the page may never have existed. Try the{' '}
              <a href="/">top items</a> or the <a href="/newest">newest</a>.
            </p>
          )}
          {props.children}
        </div>
      </div>
    </Layout>
  )
}
