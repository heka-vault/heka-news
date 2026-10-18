// Accounts at sign-in (ADR 0003, 0007): find the member by GitHub id, or create one, either as a
// moderator bootstrapping the tree (no inviter) or by redeeming an invitation, in one transaction
// so an invitation is used exactly once.

import { MARKDOWN_VERSION } from '../lib/markdown.ts'
import type { Db } from './index.ts'

export interface GitHubIdentity {
  githubId: number
  login: string
  name: string | null
  avatarUrl: string | null
}

/** GitHub's name, trimmed to what users.display_name allows (1 to 80 characters), or null. */
function displayNameFrom(name: string | null): string | null {
  if (!name) return null
  const chars = Array.from(name.trim())
  return chars.length === 0 ? null : chars.slice(0, 80).join('')
}

/**
 * Refresh what GitHub owns on an existing member: the login (GitHub renames), the avatar, and
 * moderator status, which mirrors MODERATORS. False if the new login belongs to another account.
 */
export function refreshAccount(
  db: Db,
  userId: number,
  identity: GitHubIdentity,
  isModerator: boolean,
): boolean {
  const clash = db
    .query<{ id: number }, [string, number]>('SELECT id FROM users WHERE login = ? AND id <> ?')
    .get(identity.login, userId)
  if (clash) return false
  db.query('UPDATE users SET login = ?, avatar_url = ?, is_moderator = ? WHERE id = ?').run(
    identity.login,
    identity.avatarUrl,
    isModerator ? 1 : 0,
    userId,
  )
  return true
}

export type CreateResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'invite' | 'login-taken' }

function loginTaken(db: Db, login: string): boolean {
  return (
    db.query<{ id: number }, [string]>('SELECT id FROM users WHERE login = ?').get(login) !== null
  )
}

function insertMember(
  db: Db,
  identity: GitHubIdentity,
  invitedBy: number | null,
  isModerator: boolean,
  now: number,
): number {
  const row = db
    .query<
      { id: number },
      [number, string, string | null, string | null, number | null, number, number, number]
    >(
      `INSERT INTO users (github_id, login, display_name, avatar_url, invited_by, is_moderator,
                          created_at, bio_html_v)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      identity.githubId,
      identity.login,
      displayNameFrom(identity.name),
      identity.avatarUrl,
      invitedBy,
      isModerator ? 1 : 0,
      now,
      MARKDOWN_VERSION,
    )
  if (!row) throw new Error(`could not create ${identity.login}`)
  return row.id
}

/** A moderator's first sign-in: a root of the invite tree, no invitation needed. */
export function createModerator(db: Db, identity: GitHubIdentity, now: number): CreateResult {
  return db.transaction((): CreateResult => {
    if (loginTaken(db, identity.login)) return { ok: false, reason: 'login-taken' }
    return { ok: true, userId: insertMember(db, identity, null, true, now) }
  })()
}

/**
 * Redeem an invitation: create the member with invited_by set and mark the invitation used, or
 * change nothing when the invitation is not open (used, revoked, expired or unknown).
 */
export function redeemInvite(
  db: Db,
  codeHash: string,
  identity: GitHubIdentity,
  isModerator: boolean,
  now: number,
): CreateResult {
  return db.transaction((): CreateResult => {
    const invite = db
      .query<{ id: number; inviter_id: number }, [string, number]>(
        `SELECT v.id, v.inviter_id FROM invites v JOIN users u ON u.id = v.inviter_id
         WHERE v.code_hash = ? AND v.used_at IS NULL AND v.revoked_at IS NULL
           AND v.expires_at > ? AND u.banned = 0`,
      )
      .get(codeHash, now)
    if (!invite) return { ok: false, reason: 'invite' }
    if (loginTaken(db, identity.login)) return { ok: false, reason: 'login-taken' }
    const userId = insertMember(db, identity, invite.inviter_id, isModerator, now)
    const used = db
      .query('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(userId, now, invite.id)
    if (used.changes !== 1) throw new Error('the invitation was used concurrently')
    return { ok: true, userId }
  })()
}
