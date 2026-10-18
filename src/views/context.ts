// What every view gets from the route: config, assets, the clock and the request path.

import type { Config } from '../config.ts'
import type { Assets } from '../lib/assets.ts'

export interface PageContext {
  config: Config
  assets: Assets
  /** Unix seconds; one value per request so every relative time on a page agrees. */
  now: number
  /** The request path, the default canonical. */
  path: string
  /** Path and query, for sign-in return links. */
  returnTo: string
  /** Always false until phase 3 adds sign-in. */
  signedIn: boolean
}

export type NavKey = 'top' | 'new' | 'posts' | 'status' | null

export function absoluteUrl(ctx: PageContext, path: string): string {
  return `${ctx.config.publicUrl}${path}`
}
