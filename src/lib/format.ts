// Small formatting helpers for counts, times and URLs. Pure functions; unit-tested.

const numberFormat = new Intl.NumberFormat('en-US')

/** 10000 -> "10,000". */
export function formatNumber(n: number): string {
  return numberFormat.format(n)
}

/** "1 point", "0 points", "10,000 points". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

const UNITS: [limit: number, seconds: number, unit: string][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [86400 * 30, 86400, 'day'],
  [86400 * 365, 86400 * 30, 'month'],
  [Number.POSITIVE_INFINITY, 86400 * 365, 'year'],
]

/** "just now", "1 minute ago", "3 hours ago", "2 years ago". */
export function timeAgo(then: number, now: number): string {
  const elapsed = Math.max(0, now - then)
  if (elapsed < 60) return 'just now'
  for (const [limit, seconds, unit] of UNITS) {
    if (elapsed < limit) return `${plural(Math.floor(elapsed / seconds), unit)} ago`
  }
  return ''
}

/** ISO 8601 for <time datetime> and structured data. */
export function isoTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

/** "18 October 2026", for titles and the moderation log. */
export function longDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Minutes to read a post of `chars` characters, at about 230 words a minute. */
export function readingMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 6 / 230))
}

/** The host of a URL without "www.", or null if it is not an http(s) URL. */
export function domainOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
