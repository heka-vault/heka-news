// What every view gets from the route: config, assets, the clock, the request path, and who is
// signed in (with their CSRF token and the votes the page needs to show).

import type { Config } from '../config.ts'
import type { Member } from '../db/types.ts'
import type { Assets } from '../lib/assets.ts'

/** The signed-in member as views see them. */
export interface Viewer extends Member {
  /** Goes in every form (and fetch's X-CSRF-Token header). */
  csrf: string
}

/** How a visitor can sign in: GitHub, the development shortcut, or not yet. */
export type SigninMode = 'github' | 'dev' | 'closed'

export interface PageContext {
  config: Config
  assets: Assets
  /** Unix seconds; one value per request so every relative time on a page agrees. */
  now: number
  /** The request path, the default canonical. */
  path: string
  /** Path and query, for sign-in return links. */
  returnTo: string
  signedIn: boolean
  viewer: Viewer | null
  signin: SigninMode
  /** A theme the visitor chose with the toggle (the heka-theme cookie); null follows the system. */
  theme: Theme | null
  /** Items and comments on this page the viewer has voted on. */
  votes: { items: Set<number>; comments: Set<number> }
}

export type Theme = 'light' | 'dark'

/**
 * The visitor's chosen theme. The cookie is set on hekafactory.com by either site's toggle
 * (src/client/theme.ts here, the header on hekafactory.com), so one choice covers both.
 */
export const THEME_COOKIE = 'heka-theme'

export function themeOf(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null
}

export type NavKey = 'top' | 'new' | 'posts' | 'status' | 'tree' | 'replies' | 'mod' | null

export function absoluteUrl(ctx: PageContext, path: string): string {
  return `${ctx.config.publicUrl}${path}`
}

/** True when the viewer wrote this (by user id). */
export function isMine(ctx: PageContext, authorId: number): boolean {
  return ctx.viewer !== null && ctx.viewer.id === authorId
}

/** True while the author may still edit (RULES.editWindow after posting). */
export function canEdit(
  ctx: PageContext,
  authorId: number,
  createdAt: number,
  window: number,
): boolean {
  return isMine(ctx, authorId) && ctx.now - createdAt < window
}
