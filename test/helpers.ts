// Shared fixtures: an in-memory database (optionally seeded) and the app around it, with a fixed
// clock so relative times and ranking are deterministic.

import { seedDatabase } from '../scripts/seed-data.ts'
import { createApp } from '../src/app.tsx'
import { loadConfig } from '../src/config.ts'
import { type Db, openDb } from '../src/db/index.ts'
import { buildAssets } from '../src/lib/assets.ts'

export const NOW = 1_792_000_000 // 2026-10-15
export const ORIGIN = 'https://news.example.test'
export const SHA = 'abc123def'

const assets = buildAssets()

export function makeApp(opts: { seed?: boolean } = {}) {
  const db: Db = openDb(':memory:')
  if (opts.seed !== false) seedDatabase(db, NOW)
  const config = loadConfig({ PUBLIC_URL: ORIGIN, GIT_SHA: SHA })
  const app = createApp({ db, config, assets, clock: () => NOW })
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
  return { db, app, get }
}

/** Every JSON-LD block in a page, parsed. */
export function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (m) => JSON.parse(m[1] ?? 'null') as Record<string, unknown>,
  )
}
