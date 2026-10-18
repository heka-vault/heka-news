// Reading members: profiles and the invite tree. All user SQL for reads lives here.

import type { Db } from './index.ts'
import type { TreeNode, UserProfile, UserRef } from './types.ts'

interface UserRow {
  id: number
  login: string
  display_name: string | null
  bio: string
  created_at: number
  is_moderator: number
  banned: number
  invited_by: number | null
}

/** A member's profile by login (case-insensitive), or null. */
export function getProfile(db: Db, login: string): UserProfile | null {
  const row = db
    .query<UserRow, [string]>(
      `SELECT id, login, display_name, bio, created_at, is_moderator, banned, invited_by
       FROM users WHERE login = ?`,
    )
    .get(login)
  if (!row) return null

  const ref = (r: { login: string; display_name: string | null }): UserRef => ({
    login: r.login,
    displayName: r.display_name,
  })
  const inviter =
    row.invited_by === null
      ? null
      : db
          .query<{ login: string; display_name: string | null }, [number]>(
            'SELECT login, display_name FROM users WHERE id = ?',
          )
          .get(row.invited_by)
  const invited = db
    .query<{ login: string; display_name: string | null }, [number]>(
      'SELECT login, display_name FROM users WHERE invited_by = ? ORDER BY created_at, id',
    )
    .all(row.id)
  const counts = db
    .query<{ items: number; comments: number }, [number, number]>(
      `SELECT (SELECT count(*) FROM items WHERE author_id = ? AND deleted = 0) AS items,
              (SELECT count(*) FROM comments WHERE author_id = ? AND deleted = 0) AS comments`,
    )
    .get(row.id, row.id)

  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    bio: row.bio,
    createdAt: row.created_at,
    isModerator: row.is_moderator === 1,
    banned: row.banned === 1,
    invitedBy: inviter ? ref(inviter) : null,
    invited: invited.map(ref),
    itemCount: counts?.items ?? 0,
    commentCount: counts?.comments ?? 0,
  }
}

/** Every member as a forest: founding members at the roots, each with the people they invited. */
export function inviteTree(db: Db): TreeNode[] {
  const rows = db
    .query<UserRow, []>(
      `SELECT id, login, display_name, bio, created_at, is_moderator, banned, invited_by
       FROM users ORDER BY created_at, id`,
    )
    .all()
  const nodes = new Map<number, TreeNode>()
  for (const row of rows) {
    nodes.set(row.id, {
      login: row.login,
      displayName: row.display_name,
      createdAt: row.created_at,
      isModerator: row.is_moderator === 1,
      banned: row.banned === 1,
      children: [],
    })
  }
  const roots: TreeNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (!node) continue
    const parent = row.invited_by === null ? undefined : nodes.get(row.invited_by)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Every member's login and join time, for /sitemap.xml. Banned members are left out. */
export function listUsersForSitemap(db: Db): { login: string; createdAt: number }[] {
  return db
    .query<{ login: string; created_at: number }, []>(
      'SELECT login, created_at FROM users WHERE banned = 0 ORDER BY created_at',
    )
    .all()
    .map((row) => ({ login: row.login, createdAt: row.created_at }))
}

/** Number of members. */
export function countUsers(db: Db): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM users').get()?.n ?? 0
}
