// The outbound half of the Discord bridge (ADR 0009). Routes record what changed in the outbox;
// this sends it to the forum through its webhook, after the response, so Discord being slow or down
// never slows a page or loses a message. Each message is built from the rows as they are when it is
// sent, so an edit made before the first send goes out once, already edited.
//
// A webhook can open a forum post and write, edit and delete its own messages in it. Renaming,
// locking and archiving a thread needs the bot token. Nothing here reads or deletes what people
// wrote on Discord.

import type { BridgeConfig } from '../config.ts'
import {
  dueOutbox,
  enqueue,
  finishOutbox,
  forgetMessage,
  forgetThread,
  messageForComment,
  type OutboundComment,
  type OutboundItem,
  type OutboxKind,
  type OutboxRow,
  outboundComment,
  outboundItem,
  retryOutbox,
  saveSiteMessage,
  saveThread,
  threadForItem,
} from '../db/bridge.ts'
import type { Db } from '../db/index.ts'
import { excerpt } from './markdown.ts'
import type { Fetch } from './talk.ts'

const API = 'https://discord.com/api/v10'
/** Discord's limit on a message's content. */
const MESSAGE_MAX = 2000
/** Discord's limit on a thread's name. */
const THREAD_NAME_MAX = 100
/** After this many failed attempts a row is dropped (and logged). */
const MAX_ATTEMPTS = 8
/** Discord's error code for a channel or thread that does not exist (deleted). */
const UNKNOWN_CHANNEL = 10003
/** Nobody gets pinged by anything we post. */
const NO_MENTIONS = { parse: [] as string[] }

export interface Outbox {
  /** True when the forum webhook is configured; nothing is recorded otherwise. */
  enabled: boolean
  /** Record a change for Discord and, outside tests, send it soon. */
  record(kind: OutboxKind, ref: { itemId?: number; commentId?: number }): void
  /** Send everything that is due. Returns how many rows were finished. */
  drain(): Promise<number>
}

export function createOutbox(opts: {
  db: Db
  bridge: BridgeConfig
  publicUrl: string
  clock: () => number
  fetch: Fetch
  /** Send right after recording (the server); tests call drain() themselves. */
  autoDrain?: boolean
}): Outbox {
  const { db, bridge, publicUrl, clock } = opts
  const enabled = bridge.forumWebhook !== ''
  let running: Promise<number> | null = null

  const itemUrl = (itemId: number) => `${publicUrl}/item/${itemId}`

  const call = async (method: string, url: string, body?: unknown, bot = false) => {
    const headers: Record<string, string> = { 'User-Agent': 'heka-news (bridge, ADR 0009)' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (bot) headers.Authorization = `Bot ${bridge.botToken}`
    const res = await opts.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return res.status === 204 ? null : ((await res.json()) as Record<string, unknown>)
    const detail = (await res.json().catch(() => ({}))) as {
      retry_after?: number
      message?: string
      code?: number
    }
    throw new DiscordError(
      res.status,
      detail.message ?? res.statusText,
      detail.retry_after,
      detail.code,
    )
  }

  const webhook = (path = '', query: Record<string, string> = {}) => {
    const url = new URL(`${bridge.forumWebhook}${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return url.toString()
  }

  const editThread = async (threadId: string, patch: Record<string, unknown>) => {
    if (!bridge.botToken) return
    await call('PATCH', `${API}/channels/${threadId}`, patch, true)
  }

  /** Open the item's forum post and remember it. Returns the thread's id. */
  const openThread = async (item: OutboundItem): Promise<string> => {
    const sent = await call('POST', webhook('', { wait: 'true' }), {
      thread_name: threadName(item),
      content: starterContent(item, itemUrl(item.id)),
      allowed_mentions: NO_MENTIONS,
    })
    const threadId = typeof sent?.channel_id === 'string' ? sent.channel_id : null
    if (!threadId) throw new DiscordError(0, 'the webhook answered without a thread')
    saveThread(db, item.id, threadId, clock())
    return threadId
  }

  const handlers: Record<OutboxKind, (row: OutboxRow) => Promise<void>> = {
    async item_created(row) {
      const item = row.itemId === null ? null : outboundItem(db, row.itemId)
      if (!item || item.deleted || threadForItem(db, item.id)) return
      await openThread(item)
    },

    async item_updated(row) {
      const item = row.itemId === null ? null : outboundItem(db, row.itemId)
      const threadId = item ? threadForItem(db, item.id) : null
      if (!item || !threadId || item.deleted) return
      // In a forum, the post's first message has the thread's id.
      await call('PATCH', webhook(`/messages/${threadId}`, { thread_id: threadId }), {
        content: starterContent(item, itemUrl(item.id)),
        allowed_mentions: NO_MENTIONS,
      })
      await editThread(threadId, { name: threadName(item) })
    },

    async item_removed(row) {
      const threadId = row.itemId === null ? null : threadForItem(db, row.itemId)
      if (!threadId) return
      await call('POST', webhook('', { wait: 'true', thread_id: threadId }), {
        content: 'This item is no longer on heka news, so replies here stay on Discord.',
        allowed_mentions: NO_MENTIONS,
      })
      await editThread(threadId, { locked: true, archived: true })
    },

    async item_restored(row) {
      const threadId = row.itemId === null ? null : threadForItem(db, row.itemId)
      if (!threadId) return
      await editThread(threadId, { archived: false, locked: false })
      await call('POST', webhook('', { wait: 'true', thread_id: threadId }), {
        content: `This item is back on heka news: <${itemUrl(row.itemId ?? 0)}>`,
        allowed_mentions: NO_MENTIONS,
      })
    },

    async comment_created(row) {
      const comment = row.commentId === null ? null : outboundComment(db, row.commentId)
      if (!comment || comment.deleted || comment.source !== 'site') return
      if (messageForComment(db, comment.id)) return
      const item = outboundItem(db, comment.itemId)
      if (!item || item.deleted) return
      const post = (threadId: string) =>
        call('POST', webhook('', { wait: 'true', thread_id: threadId }), {
          content: commentContent(comment, `${itemUrl(comment.itemId)}#c${comment.id}`),
          username: webhookName(comment.login),
          avatar_url: comment.avatarUrl ?? undefined,
          allowed_mentions: NO_MENTIONS,
        })
      // An item from before the bridge, or whose thread was deleted on Discord, gets its thread
      // when the first new comment arrives; the comments before it stay on the site.
      let threadId = threadForItem(db, item.id) ?? (await openThread(item))
      let sent: Record<string, unknown> | null
      try {
        sent = await post(threadId)
      } catch (error) {
        if (!(error instanceof DiscordError && error.code === UNKNOWN_CHANNEL)) throw error
        forgetThread(db, item.id)
        threadId = await openThread(item)
        sent = await post(threadId)
      }
      if (typeof sent?.id !== 'string') throw new DiscordError(0, 'the webhook returned no id')
      saveSiteMessage(db, { messageId: sent.id, commentId: comment.id, threadId }, clock())
    },

    async comment_updated(row) {
      const ref = row.commentId === null ? null : messageForComment(db, row.commentId)
      const comment = ref ? outboundComment(db, ref.commentId) : null
      if (!ref || !comment || ref.origin !== 'site' || comment.deleted) return
      await call('PATCH', webhook(`/messages/${ref.messageId}`, { thread_id: ref.threadId }), {
        content: commentContent(comment, `${itemUrl(comment.itemId)}#c${comment.id}`),
        allowed_mentions: NO_MENTIONS,
      })
    },

    async comment_deleted(row) {
      const ref = row.commentId === null ? null : messageForComment(db, row.commentId)
      if (!ref || ref.origin !== 'site') return
      await call('DELETE', webhook(`/messages/${ref.messageId}`, { thread_id: ref.threadId }))
      forgetMessage(db, ref.messageId)
    },
  }

  const sendDue = async (): Promise<number> => {
    let finished = 0
    for (;;) {
      const rows = dueOutbox(db, clock())
      if (rows.length === 0) return finished
      for (const row of rows) {
        try {
          await handlers[row.kind](row)
          finishOutbox(db, row.id)
          finished++
        } catch (error) {
          const failure = error instanceof DiscordError ? error : null
          const message = error instanceof Error ? error.message : String(error)
          // A message or thread that is gone, or a request Discord will never take: stop trying.
          const permanent =
            failure !== null &&
            failure.status >= 400 &&
            failure.status < 500 &&
            failure.status !== 429
          if (permanent || row.attempts + 1 >= MAX_ATTEMPTS) {
            console.error(`discord: dropped ${row.kind} #${row.id}: ${message}`)
            finishOutbox(db, row.id)
            continue
          }
          const wait = failure?.retryAfter
            ? Math.ceil(failure.retryAfter)
            : Math.min(30 * 2 ** row.attempts, 3600)
          retryOutbox(db, row.id, message, clock() + wait)
          console.error(`discord: ${row.kind} #${row.id} failed, retrying in ${wait}s: ${message}`)
          // Anything after it in this batch may depend on it (a comment on a thread not yet open).
          return finished
        }
      }
    }
  }

  const drain = (): Promise<number> => {
    if (!enabled) return Promise.resolve(0)
    if (running) return running
    running = sendDue().finally(() => {
      running = null
    })
    return running
  }

  return {
    enabled,
    record(kind, ref) {
      if (!enabled) return
      enqueue(db, kind, ref, clock())
      if (opts.autoDrain) setTimeout(() => void drain(), 0)
    },
    drain,
  }
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
    /** Discord's JSON error code, e.g. 10003 Unknown Channel. */
    readonly code?: number,
  ) {
    super(`Discord ${status}: ${message}`)
  }
}

/** The forum post's title: the item's title, or for a status, who wrote it and how it starts. */
export function threadName(item: OutboundItem): string {
  const name = item.title ?? `${item.login}: ${firstLine(item.bodyMd)}`
  return excerpt(name.replace(/\s+/g, ' ').trim() || `Item ${item.id}`, THREAD_NAME_MAX)
}

/** The forum post's first message: the link or the start of the text, who posted it, and where. */
export function starterContent(item: OutboundItem, url: string): string {
  const lines: string[] = []
  if (item.url) lines.push(item.url)
  if (item.bodyMd.trim()) lines.push(excerpt(item.bodyMd.trim().replace(/\s+/g, ' '), 300))
  const tags = item.tags.length > 0 ? ` · ${item.tags.join(', ')}` : ''
  lines.push(`Posted by **${escapeMarkdown(item.login)}**${tags}`)
  lines.push(`Discuss on heka news: <${url}>`)
  return lines.join('\n')
}

/**
 * A comment as a Discord message: the first line of what it replies to, quoted, then the text,
 * cut to fit with a link to the rest.
 */
export function commentContent(comment: OutboundComment, url: string): string {
  const quote =
    comment.parent && !comment.parent.deleted
      ? `> **${escapeMarkdown(comment.parent.login)}**: ${excerpt(firstLine(comment.parent.bodyMd), 120)}\n`
      : ''
  const body = comment.bodyMd.trim()
  const whole = `${quote}${body}`
  if (whole.length <= MESSAGE_MAX) return whole
  const tail = `…\nContinued on heka news: <${url}>`
  return `${quote}${body.slice(0, MESSAGE_MAX - quote.length - tail.length)}${tail}`
}

/** Webhook names are 1 to 80 characters and may not contain "discord" or "clyde". */
export function webhookName(login: string): string {
  return /discord|clyde/i.test(login) ? 'heka news member' : login.slice(0, 80)
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.replace(/^[>#\s*-]+/, '').trim())
      .find(Boolean) ?? ''
  )
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>])/g, '\\$1')
}
