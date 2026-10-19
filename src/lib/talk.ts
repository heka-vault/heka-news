// "Talk to us" (ADR 0008): asking ElevenLabs for a conversation token, checking the post-call
// webhook's signature, and turning a finished conversation into a Discord message. No routes and
// no SQL here; src/routes/talk.ts wires these up.

import { createHmac } from 'node:crypto'
import { TALK } from '../config.ts'
import { safeEqual } from './crypto.ts'

const TOKEN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/token'

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: 'busy' | 'upstream'; status: number }

/**
 * A WebRTC conversation token for the agent. The API key goes in a header to ElevenLabs and
 * nowhere else. Over quota or concurrency (402, 429) is "busy"; anything else that is not a token
 * is "upstream", including a timeout.
 */
export async function conversationToken(
  fetchImpl: Fetch,
  apiKey: string,
  agentId: string,
): Promise<TokenResult> {
  const url = `${TOKEN_URL}?agent_id=${encodeURIComponent(agentId)}`
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(TALK.upstreamTimeoutMs),
    })
  } catch {
    return { ok: false, error: 'upstream', status: 0 }
  }
  if (res.status === 402 || res.status === 429)
    return { ok: false, error: 'busy', status: res.status }
  if (!res.ok) return { ok: false, error: 'upstream', status: res.status }
  const body = (await res.json().catch(() => null)) as { token?: unknown } | null
  if (typeof body?.token !== 'string' || body.token === '') {
    return { ok: false, error: 'upstream', status: res.status }
  }
  return { ok: true, token: body.token }
}

/** The ElevenLabs-Signature value for a body: what ElevenLabs sends, and what tests sign with. */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return `t=${timestamp},v0=${digest}`
}

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'bad'

/**
 * Check the ElevenLabs-Signature header: `t=<unix seconds>,v0=<hex HMAC-SHA256 of "<t>.<raw
 * body>">` under the webhook secret, the scheme of `constructEvent` in the official
 * @elevenlabs/elevenlabs-js SDK. Like the SDK, a signature older than 30 minutes is refused; we
 * also refuse one from more than 30 minutes ahead.
 */
export function checkSignature(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
  now: number,
): SignatureCheck {
  if (!header) return 'missing'
  const parts = header.split(',').map((part) => part.trim())
  const t = parts.find((part) => part.startsWith('t='))?.slice(2)
  const v0 = parts.find((part) => part.startsWith('v0='))
  if (!t || !v0 || !/^\d{1,12}$/.test(t)) return 'bad'
  const timestamp = Number(t)
  if (Math.abs(now - timestamp) > TALK.signatureTolerance) return 'stale'
  const expected = signWebhook(secret, timestamp, rawBody).split(',')[1] ?? ''
  return safeEqual(v0, expected) ? 'ok' : 'bad'
}

/** The parts of a post-call transcription webhook we read. Everything else is ignored. */
export interface PostCall {
  type?: unknown
  data?: {
    agent_id?: unknown
    conversation_id?: unknown
    metadata?: { call_duration_secs?: unknown }
    analysis?: {
      call_successful?: unknown
      transcript_summary?: unknown
      data_collection_results?: Record<string, { value?: unknown } | undefined>
    }
  }
}

/** The data-collection fields the agent fills in (docs/talk-agent.md), in the order shown. */
export const COLLECTED = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['interest', 'Interest'],
  ['request', 'What they want'],
] as const

/** Discord's limit on a message's content. */
export const DISCORD_MAX = 2000

/**
 * Text a visitor said (or an LLM summarized) as plain text in Discord markdown: one line, no
 * markdown, no mentions that ping, no masked links, and at most `max` characters.
 */
export function plain(value: unknown, max: number): string {
  const text = (typeof value === 'string' ? value : value == null ? '' : String(value))
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const short = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
  // Escape every character Discord gives meaning to (an escaped < also stops <@id> mentions), and
  // break @everyone and @here even though allowed_mentions already stops them pinging. Other @s
  // stay whole, so an email address can be copied.
  return short.replace(/[\\*_~`|>#[\]()<]/g, '\\$&').replace(/@(everyone|here)/gi, '@\u200b$1')
}

function duration(value: unknown): string {
  const secs = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (secs === null) return 'unknown length'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export interface DiscordBody {
  content: string
  allowed_mentions: { parse: [] }
  /** 4: SUPPRESS_EMBEDS, so a link a visitor said does not unfurl. */
  flags: 4
}

/**
 * The Discord webhook body for one finished conversation. Mentions are off and link previews are
 * suppressed, whatever it says.
 */
export function discordMessage(event: PostCall): DiscordBody {
  const data = event.data ?? {}
  const analysis = data.analysis ?? {}
  const collected = analysis.data_collection_results ?? {}
  const lines = [
    `**Talk to us: a conversation on hekafactory.com** (${duration(data.metadata?.call_duration_secs)})`,
  ]
  for (const [id, label] of COLLECTED) {
    const value = plain(collected[id]?.value, 200)
    if (value) lines.push(`**${label}:** ${value}`)
  }
  const outcome = plain(analysis.call_successful, 20)
  if (outcome) lines.push(`**Outcome:** ${outcome}`)
  lines.push(`**Conversation:** ${plain(data.conversation_id, 80) || 'unknown'}`)
  const head = lines.join('\n')
  // The summary gets whatever room is left under Discord's limit, with a margin.
  const room = DISCORD_MAX - head.length - 40
  const summary = room > 50 ? plain(analysis.transcript_summary, Math.min(room, 1200)) : ''
  const content = summary
    ? `${lines[0]}\n**Summary:** ${summary}\n${lines.slice(1).join('\n')}`
    : head
  return { content: content.slice(0, DISCORD_MAX), allowed_mentions: { parse: [] }, flags: 4 }
}

/** Post the message; true when Discord accepted it. */
export async function postToDiscord(
  fetchImpl: Fetch,
  webhookUrl: string,
  body: DiscordBody,
): Promise<boolean> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TALK.upstreamTimeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}
