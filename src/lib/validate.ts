// Validation for everything a member submits. Pure functions: each takes the raw form fields and
// returns either clean values or one message per bad field, in the words the form shows next to
// it. Limits match the schema's CHECK constraints (src/db/migrations/0001_init.sql).

import type { FlagReason, ItemKind } from '../db/types.ts'
import { MAX_TAGS } from '../db/write.ts'
import { domainOf } from './format.ts'

export type Fields = Record<string, string | string[] | undefined>
export type Errors = Record<string, string>
export type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors }

export const LIMITS = {
  title: 160,
  url: 2000,
  linkText: 10_000,
  post: 100_000,
  status: 500,
  comment: 10_000,
  displayName: 80,
  bio: 2000,
  inviteNote: 200,
  reason: 500,
  tagName: 24,
  tagDescription: 200,
} as const

/** Characters as SQLite's length() counts them (code points), not UTF-16 units. */
export function charCount(text: string): number {
  return Array.from(text).length
}

/** One field as a string: the last value if repeated, '' if absent. */
export function field(fields: Fields, name: string): string {
  const value = fields[name]
  if (Array.isArray(value)) return value[value.length - 1] ?? ''
  return value ?? ''
}

/** A field that may repeat (tag checkboxes) as a list. */
export function fieldList(fields: Fields, name: string): string[] {
  const value = fields[name]
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== '')
}

/** Line endings normalized, trailing whitespace off the end. Markdown keeps its inner spacing. */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trimEnd()
}

/** One line: whitespace runs collapsed, ends trimmed. */
export function cleanLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}`

function within(text: string, max: number, what: string): string | null {
  const n = charCount(text)
  return n > max
    ? `${what} can be up to ${plural(max, 'characters')}; this is ${plural(n, 'characters')}.`
    : null
}

export interface ItemInput {
  kind: ItemKind
  title: string | null
  url: string | null
  bodyMd: string
  tags: string[]
}

export function validateTags(tags: string[], known: Set<string>): string | null {
  const unique = [...new Set(tags)]
  if (unique.length === 0) return 'Pick at least one tag.'
  if (unique.length > MAX_TAGS) return `Pick up to ${MAX_TAGS} tags; you picked ${unique.length}.`
  if (unique.some((tag) => !known.has(tag))) return 'Pick tags from the list.'
  return null
}

/** A new item of `kind`, or a post's or link's edit when `editing` (the URL is not editable). */
export function validateItem(
  kind: ItemKind,
  fields: Fields,
  knownTags: Set<string>,
  opts: { editing?: boolean } = {},
): Result<ItemInput> {
  const errors: Errors = {}
  const title = kind === 'status' ? null : cleanLine(field(fields, 'title'))
  const bodyMd = cleanText(field(fields, 'body'))
  const tags = [...new Set(fieldList(fields, 'tags'))]
  let url: string | null = null

  if (title !== null) {
    if (title === '') errors.title = 'Give it a title.'
    else {
      const long = within(title, LIMITS.title, 'A title')
      if (long) errors.title = long
    }
  }

  if (kind === 'link' && !opts.editing) {
    const raw = field(fields, 'url').trim()
    if (raw === '') errors.url = 'Paste the link’s address.'
    else if (raw.length > LIMITS.url)
      errors.url = `An address can be up to ${plural(LIMITS.url, 'characters')}.`
    else if (!domainOf(raw))
      errors.url = 'That is not a web address. It should start with https://.'
    else url = new URL(raw).toString()
  }

  if (kind === 'link') {
    const long = within(bodyMd, LIMITS.linkText, 'The text')
    if (long) errors.body = long
  } else if (kind === 'post') {
    if (bodyMd.trim() === '') errors.body = 'Write the post.'
    else {
      const long = within(bodyMd, LIMITS.post, 'A post')
      if (long) errors.body = long
    }
  } else {
    if (bodyMd.trim() === '') errors.body = 'Write the note.'
    else {
      const long = within(bodyMd, LIMITS.status, 'A status note')
      if (long) errors.body = long
    }
  }

  const tagError = validateTags(tags, knownTags)
  if (tagError) errors.tags = tagError

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { kind, title, url, bodyMd, tags } }
}

export function validateComment(fields: Fields): Result<string> {
  const body = cleanText(field(fields, 'body'))
  if (body.trim() === '') return { ok: false, errors: { body: 'Write something first.' } }
  const long = within(body, LIMITS.comment, 'A comment')
  if (long) return { ok: false, errors: { body: long } }
  return { ok: true, value: body }
}

export function validateProfile(
  fields: Fields,
): Result<{ displayName: string | null; bio: string }> {
  const errors: Errors = {}
  const displayName = cleanLine(field(fields, 'display_name'))
  const bio = cleanText(field(fields, 'bio'))
  const longName = within(displayName, LIMITS.displayName, 'A display name')
  if (longName) errors.display_name = longName
  const longBio = within(bio, LIMITS.bio, 'A bio')
  if (longBio) errors.bio = longBio
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { displayName: displayName || null, bio } }
}

export function validateInviteNote(fields: Fields): Result<string> {
  const note = cleanLine(field(fields, 'note'))
  const long = within(note, LIMITS.inviteNote, 'A note')
  return long ? { ok: false, errors: { note: long } } : { ok: true, value: note }
}

/** A moderator's reason: required, because it is published in the log. */
export function validateReason(fields: Fields): Result<string> {
  const reason = cleanLine(field(fields, 'reason'))
  if (reason === '')
    return {
      ok: false,
      errors: { reason: 'Give a reason. It is published in the moderation log.' },
    }
  const long = within(reason, LIMITS.reason, 'A reason')
  return long ? { ok: false, errors: { reason: long } } : { ok: true, value: reason }
}

export const FLAG_REASONS: { value: FlagReason; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam', hint: 'Advertising, or posted only to promote something.' },
  {
    value: 'off-topic',
    label: 'Off-topic',
    hint: 'Not about building software with coding agents.',
  },
  { value: 'unkind', label: 'Unkind or abusive', hint: 'Attacks a person instead of an idea.' },
]

export function validateFlagReason(fields: Fields): Result<FlagReason> {
  const reason = field(fields, 'reason')
  const match = FLAG_REASONS.find((r) => r.value === reason)
  return match
    ? { ok: true, value: match.value }
    : { ok: false, errors: { reason: 'Pick a reason.' } }
}

export function validateTag(fields: Fields): Result<{ name: string; description: string }> {
  const errors: Errors = {}
  const name = field(fields, 'name').trim().toLowerCase()
  const description = cleanLine(field(fields, 'description'))
  if (!/^[a-z0-9]{1,24}$/.test(name)) {
    errors.name = 'Use 1 to 24 lowercase letters and digits, no spaces.'
  }
  const long = within(description, LIMITS.tagDescription, 'A description')
  if (long) errors.description = long
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { name, description } }
}

/**
 * The form of a URL used to spot duplicates: scheme and "www." ignored, host lowercased, the
 * fragment and tracking parameters dropped, a trailing slash ignored.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const params = [...url.searchParams.entries()].filter(
      ([key]) => !/^(utm_[a-z]+|fbclid|gclid|mc_eid|ref|ref_src)$/i.test(key),
    )
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
    const path = url.pathname.replace(/\/+$/, '')
    const port = url.port ? `:${url.port}` : ''
    return `${host}${port}${path}${query}`
  } catch {
    return raw
  }
}
