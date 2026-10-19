import { describe, expect, test } from 'bun:test'
import { RULES } from '../src/config.ts'
import {
  commentForMessage,
  messageForComment,
  outboxSize,
  saveThread,
  threadForItem,
} from '../src/db/bridge.ts'
import { getComment } from '../src/db/comments.ts'
import { linkDiscord } from '../src/db/discord.ts'
import { accountByLogin } from '../src/db/users.ts'
import { commentContent, webhookName } from '../src/lib/outbox.ts'
import { parseEvent } from '../src/routes/bridge.ts'
import { type AppFixture, type Member, makeApp, NOW, ORIGIN, signIn } from './helpers.ts'

const WEBHOOK = 'https://discord.com/api/webhooks/111/hook-token'
const BRIDGE_TOKEN = 'bridge-token-for-tests'
const BRIDGE_ENV = {
  DISCORD_FORUM_WEBHOOK: WEBHOOK,
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_BRIDGE_TOKEN: BRIDGE_TOKEN,
}

interface Call {
  method: string
  url: URL
  body: Record<string, unknown> | null
  auth: string | null
}

/** A Discord that opens threads and stores messages, and records every request. */
function fakeDiscord() {
  const calls: Call[] = []
  let next = 5000
  let failWith: number | null = null
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const headers = new Headers(init?.headers)
    calls.push({ method: init?.method ?? 'GET', url, body, auth: headers.get('authorization') })
    if (failWith !== null) {
      return Response.json({ message: 'nope', retry_after: 7 }, { status: failWith })
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    const id = String(next++)
    const thread = url.searchParams.get('thread_id')
    return Response.json({ id, channel_id: thread ?? `9${id}` })
  }
  return {
    fetch,
    calls,
    fail(status: number | null) {
      failWith = status
    },
  }
}

function bridgeApp(env: Record<string, string> = BRIDGE_ENV) {
  const discord = fakeDiscord()
  const fx = makeApp({ env, fetch: discord.fetch })
  return { fx, discord }
}

async function postStatus(member: Member, body = 'Shipped the bridge today.') {
  const res = await member.post('/submit?kind=status', { body, tags: ['agents'] })
  const id = Number(res.headers.get('Location')?.match(/\/item\/(\d+)/)?.[1])
  if (!id) throw new Error(`no item: ${res.status}`)
  return id
}

async function comment(member: Member, itemId: number, body: string, parent?: number) {
  const res = await member.post(`/item/${itemId}/comments`, {
    body,
    ...(parent ? { parent: String(parent) } : {}),
  })
  const id = Number(res.headers.get('Location')?.match(/#c(\d+)/)?.[1])
  if (!id) throw new Error(`no comment: ${res.status}`)
  return id
}

function event(fx: AppFixture, body: unknown, token = BRIDGE_TOKEN) {
  return fx.app.request('/api/discord/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function link(fx: AppFixture, login: string, discordId: string) {
  const account = accountByLogin(fx.db, login)
  if (!account) throw new Error(`no ${login}`)
  linkDiscord(fx.db, account.id, { discordId, username: login }, NOW)
}

describe('outbound', () => {
  test('without the webhook nothing is recorded', async () => {
    const fx = makeApp()
    await postStatus(signIn(fx, 'quietfox'))
    expect(outboxSize(fx.db)).toBe(0)
  })

  test('a new item opens a forum post that links back', async () => {
    const { fx, discord } = bridgeApp()
    const id = await postStatus(signIn(fx, 'quietfox'))
    expect(await fx.outbox.drain()).toBe(1)
    const [call] = discord.calls
    expect(`${call?.url.origin}${call?.url.pathname}`).toBe(WEBHOOK)
    expect(call?.url.searchParams.get('wait')).toBe('true')
    expect(call?.body?.thread_name).toBe('quietfox: Shipped the bridge today.')
    expect(call?.body?.content).toContain(`<${ORIGIN}/item/${id}>`)
    expect(call?.body?.allowed_mentions).toEqual({ parse: [] })
    expect(threadForItem(fx.db, id)).toBe('95000')
    expect(outboxSize(fx.db)).toBe(0)
  })

  test('comments go into the thread under the member, replies quote the parent', async () => {
    const { fx, discord } = bridgeApp()
    const m = signIn(fx, 'quietfox')
    const item = await postStatus(m)
    const first = await comment(m, item, 'First line here.\n\nMore.')
    const reply = await comment(signIn(fx, 'oxbow'), item, 'Agreed.', first)
    await fx.outbox.drain()
    const [, a, b] = discord.calls
    expect(a?.url.searchParams.get('thread_id')).toBe('95000')
    expect(a?.body?.username).toBe('quietfox')
    expect(a?.body?.content).toBe('First line here.\n\nMore.')
    expect(b?.body?.content).toBe('> **quietfox**: First line here.\nAgreed.')
    expect(messageForComment(fx.db, reply)?.origin).toBe('site')
  })

  test('editing and deleting a comment edits and deletes its copy', async () => {
    const { fx, discord } = bridgeApp()
    const m = signIn(fx, 'quietfox')
    const item = await postStatus(m)
    const c = await comment(m, item, 'Typo hree.')
    await fx.outbox.drain()
    const messageId = messageForComment(fx.db, c)?.messageId
    await m.post(`/c/${c}/edit`, { body: 'Typo here.' })
    await fx.outbox.drain()
    await m.post(`/c/${c}/delete`)
    await fx.outbox.drain()
    const [edit, del] = discord.calls.slice(2)
    expect(edit?.method).toBe('PATCH')
    expect(edit?.url.pathname).toEndWith(`/messages/${messageId}`)
    expect(edit?.body?.content).toBe('Typo here.')
    expect(del?.method).toBe('DELETE')
    expect(messageForComment(fx.db, c)).toBeNull()
  })

  test('a retitled item renames its thread with the bot token', async () => {
    const { fx, discord } = bridgeApp()
    const m = signIn(fx, 'quietfox')
    const res = await m.post('/submit?kind=post', {
      title: 'First title',
      body: 'Text.',
      tags: ['agents'],
    })
    const id = Number(res.headers.get('Location')?.match(/\/item\/(\d+)/)?.[1])
    await fx.outbox.drain()
    await m.post(`/item/${id}/edit`, { title: 'Better title', body: 'Text.', tags: ['agents'] })
    await fx.outbox.drain()
    const rename = discord.calls.find((c) => c.url.pathname === '/api/v10/channels/95000')
    expect(rename?.body).toEqual({ name: 'Better title' })
    expect(rename?.auth).toBe('Bot bot-token')
  })

  test('a removed item gets a note and its thread is locked', async () => {
    const { fx, discord } = bridgeApp()
    const id = await postStatus(signIn(fx, 'quietfox'))
    await fx.outbox.drain()
    await signIn(fx, 'ledgerline').post(`/item/${id}/remove`, { reason: 'Off-topic.' })
    await fx.outbox.drain()
    const [, note, lock] = discord.calls
    expect(note?.body?.content).toContain('no longer on heka news')
    expect(lock?.body).toEqual({ locked: true, archived: true })
  })

  test('an item from before the bridge gets nothing', async () => {
    const { fx, discord } = bridgeApp()
    await comment(signIn(fx, 'quietfox'), 1, 'On an old item.')
    await fx.outbox.drain()
    expect(discord.calls).toHaveLength(0)
  })

  test('a failure waits and keeps the order; a refusal is dropped', async () => {
    const { fx, discord } = bridgeApp()
    const m = signIn(fx, 'quietfox')
    const item = await postStatus(m)
    await comment(m, item, 'Waits for the thread.')
    discord.fail(503)
    expect(await fx.outbox.drain()).toBe(0)
    expect(discord.calls).toHaveLength(1)
    expect(outboxSize(fx.db)).toBe(2)
    discord.fail(null)
    expect(await fx.outbox.drain()).toBe(0) // not due yet
    fx.advance(30)
    expect(await fx.outbox.drain()).toBe(2)
    expect(discord.calls.map((c) => c.url.searchParams.get('thread_id'))).toEqual([
      null,
      null,
      '95000',
    ])

    await comment(m, item, 'Refused.')
    discord.fail(403)
    expect(await fx.outbox.drain()).toBe(0)
    expect(outboxSize(fx.db)).toBe(0)
  })

  test('long comments are cut with a link; webhook names avoid reserved words', () => {
    const long = commentContent(
      {
        id: 1,
        itemId: 2,
        bodyMd: 'x'.repeat(3000),
        login: 'a',
        avatarUrl: null,
        deleted: false,
        source: 'site',
        parent: null,
      },
      'https://news.example.test/item/2#c1',
    )
    expect(long.length).toBeLessThanOrEqual(2000)
    expect(long).toEndWith('Continued on heka news: <https://news.example.test/item/2#c1>')
    expect(webhookName('discordfan')).toBe('heka news member')
    expect(webhookName('quietfox')).toBe('quietfox')
  })
})

describe('inbound', () => {
  /** An item with a thread, and quietfox linked to Discord user 700. */
  async function bridged() {
    const { fx, discord } = bridgeApp()
    const m = signIn(fx, 'quietfox')
    const item = await postStatus(m)
    await fx.outbox.drain()
    link(fx, 'quietfox', '700')
    const thread = threadForItem(fx.db, item) ?? ''
    const create = (messageId: string, content: string, extra: Record<string, unknown> = {}) =>
      event(fx, {
        type: 'message_create',
        messageId,
        threadId: thread,
        author: { id: '700' },
        content,
        ...extra,
      })
    return { fx, discord, m, item, thread, create }
  }

  test('answers 404 until the token is set, and 401 without it', async () => {
    const fx = makeApp()
    expect((await event(fx, {})).status).toBe(404)
    const { fx: on } = bridgeApp()
    expect((await event(on, {}, 'wrong')).status).toBe(401)
    expect((await on.app.request('/api/discord/threads?since=0')).status).toBe(401)
  })

  test('a linked member’s message becomes a comment marked via Discord, once', async () => {
    const { fx, discord, item, create } = await bridged()
    const res = await (await create('800', 'From Discord.')).json()
    expect(res.result).toBe('carried')
    expect(res.url).toBe(`${ORIGIN}/item/${item}#c${res.commentId}`)
    const html = await (await fx.get(`/item/${item}`)).text()
    expect(html).toContain('From Discord.')
    expect(html).toContain('via Discord')
    expect((await (await create('800', 'From Discord.')).json()).result).toBe('duplicate')
    // Never posted back to Discord.
    await fx.outbox.drain()
    expect(discord.calls).toHaveLength(1)
  })

  test('replying to a comment’s message threads under it', async () => {
    const { fx, m, item, create } = await bridged()
    const parent = await comment(m, item, 'Site comment.')
    await fx.outbox.drain()
    const parentMessage = messageForComment(fx.db, parent)?.messageId
    const res = await (await create('801', 'Reply.', { replyTo: parentMessage })).json()
    expect(getComment(fx.db, res.commentId)?.parentId).toBe(parent)
  })

  test('someone who has not connected is nudged once', async () => {
    const { create, fx, thread } = await bridged()
    const send = (id: string) =>
      event(fx, {
        type: 'message_create',
        messageId: id,
        threadId: thread,
        author: { id: '999' },
        content: 'hi',
      })
    expect(await (await send('810')).json()).toEqual({
      result: 'unlinked',
      nudge: true,
      connectUrl: `${ORIGIN}/settings#discord-heading`,
    })
    expect((await (await send('811')).json()).nudge).toBe(false)
    expect((await (await create('812', 'linked')).json()).result).toBe('carried')
  })

  test('refusals say why; a ban says nothing', async () => {
    const { fx, create } = await bridged()
    expect(await (await create('820', '   ')).json()).toMatchObject({
      result: 'refused',
      notify: true,
    })
    await signIn(fx, 'ledgerline').post('/u/quietfox/ban', { reason: 'Spam.' })
    expect(await (await create('821', 'hello')).json()).toEqual({
      result: 'refused',
      reason: 'banned',
      notify: false,
    })
  })

  test('messages in unknown threads are ignored', async () => {
    const { fx } = await bridged()
    const res = await event(fx, {
      type: 'message_create',
      messageId: '830',
      threadId: '123',
      author: { id: '700' },
      content: 'x',
    })
    expect((await res.json()).result).toBe('ignored')
  })

  test('edits inside the window update the comment; deleting deletes it', async () => {
    const { fx, create } = await bridged()
    const { commentId } = await (await create('840', 'Frist.')).json()
    const update = (content: string) =>
      event(fx, { type: 'message_update', messageId: '840', content })
    expect((await (await update('First.')).json()).result).toBe('updated')
    expect(getComment(fx.db, commentId)?.bodyMd).toBe('First.')
    fx.advance(RULES.editWindow + 1)
    expect((await (await update('Too late.')).json()).result).toBe('too_late')
    const del = await event(fx, { type: 'message_delete', messageId: '840' })
    expect((await del.json()).result).toBe('deleted')
    expect(getComment(fx.db, commentId)?.deleted).toBe(true)
  })

  test('active threads come with the newest message carried in', async () => {
    const { fx, create, thread } = await bridged()
    await create('9', 'a')
    await create('10', 'b')
    const res = await fx.app.request(`/api/discord/threads?since=${NOW - 60}`, {
      headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
    })
    expect(await res.json()).toEqual({ threads: [{ threadId: thread, after: '10' }] })
  })

  test('events are checked field by field', () => {
    expect(parseEvent('nope')).toBeNull()
    expect(parseEvent(JSON.stringify({ type: 'message_delete', messageId: 'x' }))).toBeNull()
    expect(
      parseEvent(
        JSON.stringify({
          type: 'message_create',
          messageId: '1',
          threadId: '2',
          author: { id: '3' },
          content: 'c',
          replyTo: 'bad',
        }),
      ),
    ).toBeNull()
  })

  test('an edit and a delete before sending go out as the delete alone', async () => {
    const { fx, discord, m, item } = await bridged()
    const c = await comment(m, item, 'Short-lived.')
    await fx.outbox.drain()
    await m.post(`/c/${c}/edit`, { body: 'Edited.' })
    await m.post(`/c/${c}/delete`)
    await fx.outbox.drain()
    expect(discord.calls.slice(2).map((call) => call.method)).toEqual(['DELETE'])
  })

  test('saveThread and commentForMessage round-trip', () => {
    const fx = makeApp()
    saveThread(fx.db, 1, '42', NOW)
    expect(threadForItem(fx.db, 1)).toBe('42')
    expect(commentForMessage(fx.db, 'missing')).toBeNull()
  })
})
