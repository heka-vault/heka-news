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

/** Membership rules (ADR 0007). Times in seconds. */
export const RULES = {
  /** A session lives this long after the member was last seen (sliding). */
  sessionTtl: 30 * 86400,
  /** How often a live session's expiry is pushed forward, at most. */
  sessionRefresh: 3600,
  /** An invitation link works for this long. */
  inviteTtl: 14 * 86400,
  /** The signed OAuth state is good for this long. */
  oauthStateTtl: 600,
  /** Authors may edit an item or a comment for this long after posting it. */
  editWindow: 2 * 3600,
  /** A link to the same URL inside this window points at the existing item. */
  duplicateWindow: 30 * 86400,
  /** Items with this many open flags leave the front page until a moderator looks. */
  flagThreshold: 3,
} as const

/** Per-member limits per hour (ADR 0007). */
export const RATE_LIMITS = {
  item: 10,
  comment: 60,
  vote: 300,
  flag: 30,
  preview: 300,
} as const

export type RateAction = keyof typeof RATE_LIMITS

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
  /**
   * GitHub logins of the founding moderators, lowercased (ADR 0003). Signing in makes them
   * moderators; moderators can make other members moderators from the site.
   */
  moderators: string[]
  /** NODE_ENV is "production". */
  production: boolean
  /** GitHub OAuth app credentials; null until both are set (sign-in then says it opens soon). */
  github: { clientId: string; clientSecret: string } | null
  /**
   * Signs OAuth state and derives CSRF tokens. SESSION_SECRET in production; outside production a
   * random value per process when unset. Sign-in stays closed in production without it.
   */
  sessionSecret: string
  /** /dev/sign-in-as/:login: only outside production, and only while GitHub is not configured. */
  devSignIn: boolean
  /** Cookies carry Secure when PUBLIC_URL is https. */
  secureCookies: boolean
}

/** True for a login in MODERATORS: a founding moderator, who cannot be removed from the site. */
export function isFoundingModerator(config: Pick<Config, 'moderators'>, login: string): boolean {
  return config.moderators.includes(login.toLowerCase())
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 8080)
  const host = env.HOST ?? '0.0.0.0'
  const production = env.NODE_ENV === 'production'
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '')
  const secret = env.SESSION_SECRET?.trim() ?? ''
  const clientId = env.GITHUB_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim() ?? ''
  // In production, GitHub sign-in needs all three values; anything missing keeps it closed.
  const githubReady = clientId !== '' && clientSecret !== '' && (secret !== '' || !production)
  return {
    host,
    port,
    databasePath: env.DATABASE_PATH ?? './data/heka-news.db',
    publicUrl,
    gitSha: env.GIT_SHA ?? 'dev',
    rankCandidates: Number(env.RANK_CANDIDATES ?? 500),
    moderators: (env.MODERATORS ?? '')
      .split(',')
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
    production,
    github: githubReady ? { clientId, clientSecret } : null,
    sessionSecret: secret || randomSecret(),
    devSignIn: !production && clientId === '',
    secureCookies: publicUrl.startsWith('https:'),
  }
}

function randomSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}
