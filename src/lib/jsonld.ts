// schema.org structured data (ADR 0006): DiscussionForumPosting for links and posts,
// SocialMediaPosting for status notes, Comment for comments, with interaction counts.

import { SITE } from '../config.ts'
import type { CommentNode, ItemDetail, UserProfile } from '../db/types.ts'
import { isoTime } from './format.ts'
import { htmlToText } from './markdown.ts'

type Json = Record<string, unknown>

function person(origin: string, login: string): Json {
  return { '@type': 'Person', name: login, url: `${origin}/u/${login}` }
}

function counter(type: 'LikeAction' | 'CommentAction', count: number): Json {
  return {
    '@type': 'InteractionCounter',
    interactionType: `https://schema.org/${type}`,
    userInteractionCount: count,
  }
}

function comment(origin: string, itemUrl: string, node: CommentNode): Json | null {
  const replies = node.children
    .map((child) => comment(origin, itemUrl, child))
    .filter((c): c is Json => c !== null)
  if (node.deleted && replies.length === 0) return null
  return {
    '@type': 'Comment',
    url: `${itemUrl}#c${node.id}`,
    ...(node.deleted
      ? { text: node.removedBy === 'author' ? '[deleted]' : 'Removed by a moderator' }
      : { author: person(origin, node.author.login), text: htmlToText(node.bodyHtml) }),
    datePublished: isoTime(node.createdAt),
    interactionStatistic: [counter('LikeAction', node.points)],
    ...(replies.length > 0 ? { comment: replies } : {}),
  }
}

/** The item page's structured data. */
export function itemJsonLd(origin: string, item: ItemDetail, comments: CommentNode[]): Json {
  const url = `${origin}/item/${item.id}`
  const text = item.bodyHtml ? htmlToText(item.bodyHtml) : undefined
  const base: Json = {
    '@context': 'https://schema.org',
    '@type': item.kind === 'status' ? 'SocialMediaPosting' : 'DiscussionForumPosting',
    '@id': url,
    url,
    mainEntityOfPage: url,
    author: person(origin, item.author.login),
    datePublished: isoTime(item.createdAt),
    ...(item.editedAt ? { dateModified: isoTime(item.editedAt) } : {}),
    ...(item.title ? { headline: item.title } : {}),
    ...(text ? { text } : {}),
    ...(item.tags.length ? { keywords: item.tags.join(', ') } : {}),
    interactionStatistic: [
      counter('LikeAction', item.points),
      counter('CommentAction', item.commentCount),
    ],
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: origin },
  }
  if (item.kind === 'link' && item.url) {
    base.sharedContent = { '@type': 'WebPage', url: item.url }
  }
  const replies = comments
    .map((node) => comment(origin, url, node))
    .filter((c): c is Json => c !== null)
  if (replies.length > 0) base.comment = replies
  return base
}

/** The front page's: the site itself. */
export function websiteJsonLd(origin: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: `${origin}/`,
    description: SITE.description,
    publisher: { '@type': 'Organization', name: SITE.parent.name, url: SITE.parent.url },
  }
}

/** A member's profile page. */
export function profileJsonLd(origin: string, user: UserProfile): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateCreated: isoTime(user.createdAt),
    mainEntity: {
      '@type': 'Person',
      name: user.displayName ?? user.login,
      alternateName: user.login,
      identifier: user.login,
      url: `${origin}/u/${user.login}`,
      ...(user.bioHtml ? { description: htmlToText(user.bioHtml) } : {}),
      interactionStatistic: [
        {
          '@type': 'InteractionCounter',
          interactionType: 'https://schema.org/WriteAction',
          userInteractionCount: user.itemCount + user.commentCount,
        },
      ],
    },
  }
}
