// "Talk to us" on hekafactory.com (ADR 0008). Two JSON endpoints, neither tied to a session:
//
//   POST /api/talk/token     a page on an allowed origin asks for a WebRTC conversation token for
//                            the agent. The API key stays here; the browser gets a token that
//                            starts one conversation. Limited per visitor and per day.
//   POST /api/talk/webhook   ElevenLabs posts each finished conversation. The signature is
//                            checked, other agents are ignored, and the summary goes to a private
//                            Discord channel, once.

import { TALK } from '../config.ts'
import {
  conversationPosted,
  markConversationPosted,
  releaseDailyToken,
  reserveDailyToken,
  takeVisitorRate,
} from '../db/talk.ts'
import { hmac } from '../lib/crypto.ts'
import { CACHE_NONE } from '../lib/http.ts'
import {
  checkSignature,
  conversationToken,
  discordMessage,
  type Fetch,
  type PostCall,
  postToDiscord,
} from '../lib/talk.ts'
import type { App, C, Web } from './web.ts'

/** The visitor's address as the Cloudflare tunnel reports it. Only the tunnel reaches the port. */
function clientIp(c: C): string {
  return (
    c.req.header('cf-connecting-ip')?.trim() ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

export function registerTalk(app: App, web: Web, fetchImpl: Fetch) {
  const talk = web.config.talk

  /** The request's Origin when it is one of the allowed sites, else null. */
  const allowedOrigin = (c: C): string | null => {
    const origin = c.req.header('origin')?.replace(/\/+$/, '')
    return origin && talk.allowedOrigins.includes(origin) ? origin : null
  }

  const cors = (c: C, origin: string) => {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  }

  app.options('/api/talk/token', (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const origin = allowedOrigin(c)
    if (!origin) return c.body(null, 403)
    cors(c, origin)
    c.header('Access-Control-Allow-Methods', 'POST')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    c.header('Access-Control-Max-Age', '600')
    return c.body(null, 204)
  })

  app.post('/api/talk/token', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    const origin = allowedOrigin(c)
    if (!origin) return c.json({ error: 'origin' }, 403)
    cors(c, origin)
    if (!talk.apiKey || !talk.agentId) return c.json({ error: 'disabled' }, 503)

    const now = web.clock()
    // The visitor is an HMAC of their address, so the table never holds an IP.
    const visitor = hmac(web.config.sessionSecret, 'talk-visitor', clientIp(c))
    if (!takeVisitorRate(web.db, visitor, TALK.perVisitorHour, now)) {
      c.header('Retry-After', '3600')
      return c.json({ error: 'rate_limited' }, 429)
    }
    if (!reserveDailyToken(web.db, talk.dailyLimit, now)) {
      return c.json({ error: 'daily_limit' }, 429)
    }
    const result = await conversationToken(fetchImpl, talk.apiKey, talk.agentId)
    if (!result.ok) {
      releaseDailyToken(web.db, now)
      console.warn(`talk: ElevenLabs token request failed (${result.status || 'no response'})`)
      return c.json({ error: result.error }, result.error === 'busy' ? 503 : 502)
    }
    return c.json({ token: result.token })
  })

  app.post('/api/talk/webhook', async (c) => {
    c.header('Cache-Control', CACHE_NONE)
    if (!talk.webhookSecret || !talk.agentId || !talk.discordWebhook) {
      return c.json({ error: 'disabled' }, 503)
    }
    const declared = Number(c.req.header('content-length') ?? 0)
    if (declared > TALK.webhookMaxBytes) return c.json({ error: 'too_large' }, 413)
    const raw = await c.req.text()
    if (Buffer.byteLength(raw) > TALK.webhookMaxBytes) return c.json({ error: 'too_large' }, 413)

    const check = checkSignature(
      c.req.header('elevenlabs-signature'),
      raw,
      talk.webhookSecret,
      web.clock(),
    )
    if (check !== 'ok') return c.json({ error: 'signature' }, 401)

    let event: PostCall
    try {
      event = JSON.parse(raw) as PostCall
    } catch {
      return c.json({ error: 'json' }, 400)
    }
    // The webhook is workspace-wide: other event types and other agents are not ours to post.
    const conversationId = event.data?.conversation_id
    if (
      event.type !== 'post_call_transcription' ||
      event.data?.agent_id !== talk.agentId ||
      typeof conversationId !== 'string' ||
      conversationId === ''
    ) {
      return c.json({ ok: true, ignored: true })
    }
    if (conversationPosted(web.db, conversationId)) return c.json({ ok: true, duplicate: true })

    // Marked as posted only once Discord has it; a failure is a 500, so ElevenLabs retries.
    if (!(await postToDiscord(fetchImpl, talk.discordWebhook, discordMessage(event)))) {
      console.warn('talk: posting a conversation summary to Discord failed')
      return c.json({ error: 'discord' }, 500)
    }
    markConversationPosted(web.db, conversationId, web.clock())
    return c.json({ ok: true })
  })
}
