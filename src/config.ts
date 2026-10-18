// Site constants and runtime configuration. Runtime values come from the environment so the same
// image runs locally, in the Lighthouse gate and in production (deploy/prod/compose.yaml).

export const SITE = {
  name: 'heka news',
  legalName: 'The Heka Vault, LLC',
  description:
    'Links, long posts and short status notes from engineers who build software with coding agents. Run by heka. Anyone can read; members are invited.',
  locale: 'en_US',
  /** The firm that runs the site. */
  parent: { name: 'heka', url: 'https://hekafactory.com' },
  /** The public mirror of this repository (ADR 0005). */
  source: 'https://github.com/heka-vault/heka-news',
} as const

/** The session cookie (ADR 0003). Its presence alone switches responses to private, no-store. */
export const SESSION_COOKIE = 'heka_session'

/** Items per list page. */
export const PAGE_SIZE = 30

export interface Config {
  host: string
  port: number
  /** SQLite file; /data/heka-news.db in production. */
  databasePath: string
  /** Origin used for canonical URLs, feeds and the sitemap, without a trailing slash. */
  publicUrl: string
  /** The commit the running code was built from; /healthz reports it. */
  gitSha: string
  /** How many of the newest items compete for the front page (ADR 0004). */
  rankCandidates: number
  /** GitHub logins of moderators (ADR 0003; used from phase 3). */
  moderators: string[]
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 8080)
  const host = env.HOST ?? '0.0.0.0'
  return {
    host,
    port,
    databasePath: env.DATABASE_PATH ?? './data/heka-news.db',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    gitSha: env.GIT_SHA ?? 'dev',
    rankCandidates: Number(env.RANK_CANDIDATES ?? 500),
    moderators: (env.MODERATORS ?? '')
      .split(',')
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  }
}
