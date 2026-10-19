// The inbound half of the Discord bridge (ADR 0009): what the relay bot calls. It is not a browser
// form, so guardPost does not apply; the bearer token (DISCORD_BRIDGE_TOKEN) stands in for the
// session and the CSRF token, and everything after it goes through the same validation, rate
// limit and write functions as the comment form. Both endpoints answer 404 until the token is set.
//
//   POST /api/discord/events   a message created, edited or deleted in a bridged thread
//   GET  /api/discord/threads  threads active since ?since=, with the newest message carried in
//
// Answers say what the bot should do on Discord: carried, unlinked (react 🔗, and DM once when
// `nudge`), refused (react ⚠️, and DM `reason` when `notify`), ignored or duplicate (nothing).

import { RATE_LIMITS, RULES } from '../config.ts'
import {
  activeThreads,
  carryComment,
  commentForMessage,
  itemForThread,
  memberByDiscordId,
  outboundItem,
  takeNudge,
} from '../db/bridge.ts'
import { getComment } from '../db/comments.ts'
import { takeRate } from '../db/ratelimit.ts'
import { authorDeleteComment, updateComment } from '../db/write.ts'
import { safeEqual } from '../lib/crypto.ts'
import { CACHE_NONE } from '../lib/http.ts'
import { validateComment } from '../lib/validate.ts'
import type { App, C, Web } from './web.ts'

/** The largest event we read. A Discord message is at most 4,000 characters. */
const MAX_BYTES = 64 * 1024
const SNOWFLAKE = /^\d{1,32}$/

type Event =
  | {
      type: 'message_create'
      messageId: string
      threadId: string
      author: { id: string }
      content: string
      replyTo: string | null
    }
  | { type: 'message_update'; messageId: string; content: string }
  | { type: 'message_delete'; messageId: string }

export function registerBridge(app: App, web: Web): void {
  const { db, config, clock } = web
  const token = config.bridge.inboundToken

  const authorized = (c: C): boolean => {
    const header = c.req.header('authorization') ?? ''
    return header.startsWith('Bearer ') && safeEqual(header.slice(7), token)
  }

  const refused = (c: C, reason: string, notify = true) =>
    c.json({ result: 'refused', reason, notify })

  app.post('/api/discord/events', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    if (!token) return c.json({ error: 'not_found' }, 404)
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
    const raw = await c.req.text()
    if (Buffer.byteLength(raw) > MAX_BYTES) return c.json({ error: 'too_large' }, 413)
    const event = parseEvent(raw)
    if (!event) return c.json({ error: 'invalid' }, 400)
    const now = clock()

    if (event.type === 'message_delete') {
      const ref = commentForMessage(db, event.messageId)
      const comment = ref?.origin === 'discord' ? getComment(db, ref.commentId) : null
      if (!comment || comment.deleted) return c.json({ result: 'ignored' })
      authorDeleteComment(db, comment.id, comment.authorId, now)
      return c.json({ result: 'deleted' })
    }

    if (event.type === 'message_update') {
      const ref = commentForMessage(db, event.messageId)
      const comment = ref?.origin === 'discord' ? getComment(db, ref.commentId) : null
      if (!comment || comment.deleted) return c.json({ result: 'ignored' })
      if (now - comment.createdAt > RULES.editWindow) return c.json({ result: 'too_late' })
      const body = validateComment({ body: event.content })
      if (!body.ok) return refused(c, `Your edit was not carried to heka news: ${body.errors.body}`)
      if (body.value !== comment.bodyMd) updateComment(db, comment.id, body.value, now)
      return c.json({ result: 'updated' })
    }

    // message_create
    if (commentForMessage(db, event.messageId)) return c.json({ result: 'duplicate' })
    const itemId = itemForThread(db, event.threadId)
    const item = itemId === null ? null : outboundItem(db, itemId)
    if (!item) return c.json({ result: 'ignored' })

    const member = memberByDiscordId(db, event.author.id)
    if (!member) {
      return c.json({
        result: 'unlinked',
        nudge: takeNudge(db, event.author.id, now),
        connectUrl: `${config.publicUrl}/settings#discord-heading`,
      })
    }
    if (member.banned) return refused(c, 'banned', false)
    if (item.deleted) {
      return refused(c, 'That item was removed on heka news, so replies there are closed.')
    }
    const body = validateComment({ body: event.content })
    if (!body.ok) return refused(c, `Your reply was not carried to heka news: ${body.errors.body}`)
    if (!takeRate(db, member.id, 'comment', RATE_LIMITS.comment, now)) {
      return refused(
        c,
        `Your reply was not carried to heka news: that is ${RATE_LIMITS.comment} comments in the last hour, the most we take from one member. Try again in a little while.`,
      )
    }

    // A Discord reply to a message that is a comment on this item replies to that comment.
    const parent = event.replyTo ? commentForMessage(db, event.replyTo) : null
    const parentComment = parent ? getComment(db, parent.commentId) : null
    const parentId = parentComment && parentComment.itemId === item.id ? parentComment.id : null

    const commentId = carryComment(
      db,
      {
        itemId: item.id,
        authorId: member.id,
        parentId,
        bodyMd: body.value,
        messageId: event.messageId,
        threadId: event.threadId,
      },
      now,
    )
    if (commentId === null) return c.json({ result: 'duplicate' })
    return c.json({
      result: 'carried',
      commentId,
      url: `${config.publicUrl}/item/${item.id}#c${commentId}`,
    })
  })

  app.get('/api/discord/threads', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    if (!token) return c.json({ error: 'not_found' }, 404)
    if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
    const since = Number(c.req.query('since') ?? '')
    if (!Number.isInteger(since) || since < 0) return c.json({ error: 'invalid' }, 400)
    return c.json({ threads: activeThreads(db, since) })
  })
}

/** The event, if the body is one we know with every field the right shape; otherwise null. */
export function parseEvent(raw: string): Event | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const id = (v: unknown): v is string => typeof v === 'string' && SNOWFLAKE.test(v)
  if (!id(data.messageId)) return null
  if (data.type === 'message_delete') return { type: 'message_delete', messageId: data.messageId }
  if (typeof data.content !== 'string') return null
  if (data.type === 'message_update') {
    return { type: 'message_update', messageId: data.messageId, content: data.content }
  }
  if (data.type !== 'message_create') return null
  const author = data.author as { id?: unknown } | undefined
  if (!id(data.threadId) || !author || !id(author.id)) return null
  if (data.replyTo !== undefined && data.replyTo !== null && !id(data.replyTo)) return null
  return {
    type: 'message_create',
    messageId: data.messageId,
    threadId: data.threadId,
    author: { id: author.id },
    content: data.content,
    replyTo: (data.replyTo as string | null | undefined) ?? null,
  }
}
