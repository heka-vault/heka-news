import { describe, expect, test } from 'bun:test'
import { TALK } from '../src/config.ts'
import { tokensIssued } from '../src/db/talk.ts'
import { checkSignature, DISCORD_MAX, discordMessage, plain, signWebhook } from '../src/lib/talk.ts'
import { makeApp, NOW } from './helpers.ts'

const SITE = 'https://hekafactory.com'
const AGENT = 'agent_test'
const WEBHOOK_SECRET = 'wsec_test-secret'
const DISCORD = 'https://discord.test/api/webhooks/1/abc'

type Call = { url: string; init?: RequestInit }

/** A fetch that answers ElevenLabs and Discord as told, and records every request. */
function fakeFetch(answers: { token?: () => Response; discord?: () => Response } = {}) {
  const calls: Call[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith('https://api.elevenlabs.io/'))
      return (answers.token ?? (() => Response.json({ token: 'tok-1' })))()
    if (url.startsWith(DISCORD))
      return (answers.discord ?? (() => new Response(null, { status: 204 })))()
    throw new Error(`unexpected fetch ${url}`)
  }
  return { fetchImpl, calls }
}

const ENV = {
  ELEVENLABS_API_KEY: 'sk_test-key',
  ELEVENLABS_AGENT_ID: AGENT,
  ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
  DISCORD_TALK_WEBHOOK: DISCORD,
  TALK_DAILY_LIMIT: '10',
}

function talkApp(
  opts: { env?: Record<string, string>; answers?: Parameters<typeof fakeFetch>[0] } = {},
) {
  const fake = fakeFetch(opts.answers)
  const fx = makeApp({ seed: false, env: { ...ENV, ...opts.env }, fetch: fake.fetchImpl })
  const token = (headers: Record<string, string> = {}) =>
    fx.app.request('/api/talk/token', {
      method: 'POST',
      headers: { origin: SITE, 'cf-connecting-ip': '203.0.113.7', ...headers },
    })
  const webhook = (
    body: unknown,
    opts: { at?: number; secret?: string; signature?: string | null } = {},
  ) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const signature =
      opts.signature === undefined
        ? signWebhook(opts.secret ?? WEBHOOK_SECRET, opts.at ?? fx.now(), raw)
        : opts.signature
    if (signature !== null) headers['elevenlabs-signature'] = signature
    return fx.app.request('/api/talk/webhook', { method: 'POST', body: raw, headers })
  }
  return { ...fx, ...fake, token, webhook }
}

function postCall(
  overrides: { agent?: string; id?: string; type?: string; summary?: string } = {},
) {
  return {
    type: overrides.type ?? 'post_call_transcription',
    event_timestamp: NOW,
    data: {
      agent_id: overrides.agent ?? AGENT,
      conversation_id: overrides.id ?? 'conv_1',
      metadata: { call_duration_secs: 134 },
      analysis: {
        call_successful: 'success',
        transcript_summary: overrides.summary ?? 'They want a workshop for six engineers in March.',
        data_collection_results: {
          name: { data_collection_id: 'name', value: 'Ada' },
          email: { data_collection_id: 'email', value: 'ada@example.com' },
          company: { data_collection_id: 'company', value: null },
          interest: { data_collection_id: 'interest', value: 'workshop' },
        },
      },
      transcript: [{ role: 'user', message: 'Hello' }],
    },
  }
}

describe('POST /api/talk/token', () => {
  test('answers an allowed origin with a token, and keeps the key server-side', async () => {
    const fx = talkApp()
    const res = await fx.token()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ token: 'tok-1' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(res.headers.get('Vary')).toContain('Origin')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    const call = fx.calls[0]
    expect(call?.url).toBe(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${AGENT}`,
    )
    expect(new Headers(call?.init?.headers).get('xi-api-key')).toBe('sk_test-key')
    expect(tokensIssued(fx.db, fx.now())).toBe(1)
  })

  test('refuses another origin, and a request with none', async () => {
    const fx = talkApp()
    for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }]) {
      const res = await fx.token(headers)
      expect(res.status).toBe(403)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
    expect(fx.calls).toHaveLength(0)
  })

  test('takes its allowed origins from TALK_ALLOWED_ORIGINS', async () => {
    const fx = talkApp({
      env: { TALK_ALLOWED_ORIGINS: 'http://localhost:4321, https://hekafactory.com/' },
    })
    expect((await fx.token({ origin: 'http://localhost:4321' })).status).toBe(200)
    expect((await fx.token({ origin: SITE, 'cf-connecting-ip': '198.51.100.1' })).status).toBe(200)
  })

  test('answers the preflight for an allowed origin only', async () => {
    const fx = talkApp()
    const ok = await fx.app.request('/api/talk/token', {
      method: 'OPTIONS',
      headers: { origin: SITE, 'access-control-request-method': 'POST' },
    })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(ok.headers.get('Access-Control-Allow-Methods')).toBe('POST')
    const no = await fx.app.request('/api/talk/token', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })
    expect(no.status).toBe(403)
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('is off without a key or an agent', async () => {
    for (const env of [{ ELEVENLABS_API_KEY: '' }, { ELEVENLABS_AGENT_ID: '' }] as Record<
      string,
      string
    >[]) {
      const fx = talkApp({ env })
      const res = await fx.token()
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'disabled' })
      expect(fx.calls).toHaveLength(0)
    }
  })

  test(`gives one visitor ${TALK.perVisitorHour} tokens an hour`, async () => {
    const fx = talkApp()
    for (let i = 0; i < TALK.perVisitorHour; i++) expect((await fx.token()).status).toBe(200)
    const over = await fx.token()
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate_limited' })
    expect(over.headers.get('Retry-After')).toBe('3600')
    // Someone else is not affected, and the visitor gets more an hour later.
    expect((await fx.token({ 'cf-connecting-ip': '198.51.100.9' })).status).toBe(200)
    fx.advance(3601)
    expect((await fx.token()).status).toBe(200)
  })

  test('stops at the daily limit, across visitors, until the next UTC day', async () => {
    const fx = talkApp({ env: { TALK_DAILY_LIMIT: '2' } })
    expect((await fx.token({ 'cf-connecting-ip': '198.51.100.1' })).status).toBe(200)
    expect((await fx.token({ 'cf-connecting-ip': '198.51.100.2' })).status).toBe(200)
    const over = await fx.token({ 'cf-connecting-ip': '198.51.100.3' })
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'daily_limit' })
    expect(fx.calls).toHaveLength(2)
    fx.advance(86400)
    expect((await fx.token({ 'cf-connecting-ip': '198.51.100.4' })).status).toBe(200)
  })

  test('a daily limit of 0 turns tokens off', async () => {
    const fx = talkApp({ env: { TALK_DAILY_LIMIT: '0' } })
    expect((await fx.token()).status).toBe(429)
  })

  test('says busy when ElevenLabs is over quota or concurrency, and does not count it', async () => {
    for (const status of [402, 429]) {
      const fx = talkApp({ answers: { token: () => new Response('no', { status }) } })
      const res = await fx.token()
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'busy' })
      expect(tokensIssued(fx.db, fx.now())).toBe(0)
    }
  })

  test('says upstream for any other failure, and does not count it', async () => {
    const answers = [
      () => new Response('down', { status: 500 }),
      () => Response.json({ nope: true }),
      () => {
        throw new Error('network')
      },
    ]
    for (const token of answers) {
      const fx = talkApp({ answers: { token } })
      const res = await fx.token()
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'upstream' })
      expect(tokensIssued(fx.db, fx.now())).toBe(0)
    }
  })

  test('never stores the visitor address', async () => {
    const fx = talkApp()
    await fx.token()
    const rows = fx.db.query<{ visitor: string }, []>('SELECT visitor FROM talk_visitors').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.visitor).not.toContain('203.0.113.7')
  })
})

describe('the webhook signature', () => {
  const body = '{"type":"post_call_transcription"}'

  test('accepts what ElevenLabs signs', () => {
    expect(checkSignature(signWebhook('s', NOW, body), body, 's', NOW)).toBe('ok')
    expect(checkSignature(signWebhook('s', NOW - 1700, body), body, 's', NOW)).toBe('ok')
  })

  test('matches the SDK scheme: t=<seconds>,v0=<hex HMAC-SHA256 of "t.body">', () => {
    const header = signWebhook('s', 1700000000, 'x')
    const digest = new Bun.CryptoHasher('sha256', 's').update('1700000000.x').digest('hex')
    expect(header).toBe(`t=1700000000,v0=${digest}`)
  })

  test('refuses a missing, malformed, wrong or tampered signature', () => {
    expect(checkSignature(null, body, 's', NOW)).toBe('missing')
    expect(checkSignature('v0=abc', body, 's', NOW)).toBe('bad')
    expect(checkSignature(`t=${NOW},v1=abc`, body, 's', NOW)).toBe('bad')
    expect(checkSignature(signWebhook('other', NOW, body), body, 's', NOW)).toBe('bad')
    expect(checkSignature(signWebhook('s', NOW, body), `${body} `, 's', NOW)).toBe('bad')
  })

  test('refuses one more than 30 minutes old or ahead', () => {
    expect(checkSignature(signWebhook('s', NOW - 1801, body), body, 's', NOW)).toBe('stale')
    expect(checkSignature(signWebhook('s', NOW + 1801, body), body, 's', NOW)).toBe('stale')
  })
})

describe('POST /api/talk/webhook', () => {
  test('posts a finished conversation to Discord once', async () => {
    const fx = talkApp()
    const res = await fx.webhook(postCall())
    expect(res.status).toBe(200)
    expect(fx.calls).toHaveLength(1)
    const call = fx.calls[0]
    expect(call?.url).toBe(DISCORD)
    const sent = JSON.parse(String(call?.init?.body)) as {
      content: string
      allowed_mentions: unknown
      flags: number
    }
    expect(sent.allowed_mentions).toEqual({ parse: [] })
    expect(sent.flags).toBe(4)
    expect(sent.content).toContain('(2m 14s)')
    expect(sent.content).toContain('**Name:** Ada')
    expect(sent.content).toContain('**Email:** ada@example.com')
    expect(sent.content).toContain('**Interest:** workshop')
    expect(sent.content).not.toContain('Company')
    expect(sent.content).toContain('**Summary:** They want a workshop')
    expect(sent.content).toContain('**Outcome:** success')
    expect(sent.content).toContain('conv\\_1')
    // A retry of the same conversation is acknowledged and not posted again.
    const again = await fx.webhook(postCall())
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, duplicate: true })
    expect(fx.calls).toHaveLength(1)
  })

  test('refuses a bad, missing or stale signature', async () => {
    const fx = talkApp()
    expect((await fx.webhook(postCall(), { secret: 'wrong' })).status).toBe(401)
    expect((await fx.webhook(postCall(), { signature: null })).status).toBe(401)
    expect((await fx.webhook(postCall(), { at: fx.now() - 3600 })).status).toBe(401)
    expect(fx.calls).toHaveLength(0)
  })

  test('ignores other agents and other event types', async () => {
    const fx = talkApp()
    for (const event of [
      postCall({ agent: 'agent_other' }),
      postCall({ type: 'post_call_audio' }),
    ]) {
      const res = await fx.webhook(event)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, ignored: true })
    }
    expect(fx.calls).toHaveLength(0)
  })

  test('answers 500 when Discord fails, and posts on the retry', async () => {
    let up = false
    const fx = talkApp({
      answers: { discord: () => new Response(null, { status: up ? 204 : 500 }) },
    })
    expect((await fx.webhook(postCall())).status).toBe(500)
    up = true
    expect((await fx.webhook(postCall())).status).toBe(200)
    expect(fx.calls).toHaveLength(2)
  })

  test('is off until the secret, the agent and the Discord webhook are all set', async () => {
    for (const env of [
      { ELEVENLABS_WEBHOOK_SECRET: '' },
      { ELEVENLABS_AGENT_ID: '' },
      { DISCORD_TALK_WEBHOOK: '' },
    ] as Record<string, string>[]) {
      const fx = talkApp({ env })
      expect((await fx.webhook(postCall())).status).toBe(503)
    }
  })

  test('refuses a body over the limit, and one that is not JSON', async () => {
    const fx = talkApp()
    const big = 'x'.repeat(TALK.webhookMaxBytes + 1)
    expect((await fx.webhook(big)).status).toBe(413)
    expect((await fx.webhook('not json')).status).toBe(400)
  })
})

describe('the Discord message', () => {
  test('neutralizes markdown, mentions and links in what a visitor said', () => {
    expect(plain('@everyone @here **hi** [x](https://e.vil) <@123>', 200)).toBe(
      '@\u200beveryone @\u200bhere \\*\\*hi\\*\\* \\[x\\]\\(https://e.vil\\) \\<@123\\>',
    )
    expect(plain('ada@example.com', 200)).toBe('ada@example.com')
    expect(plain('one\nline\u0007', 200)).toBe('one line')
    expect(plain('abcdef', 4)).toBe('abc…')
  })

  test(`stays under Discord's ${DISCORD_MAX} characters with a huge summary`, () => {
    const event = postCall({ summary: 'word '.repeat(5000) })
    const { content } = discordMessage(event)
    expect(content.length).toBeLessThanOrEqual(DISCORD_MAX)
    expect(content).toContain('**Conversation:**')
  })
})
