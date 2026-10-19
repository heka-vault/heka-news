// Reading members: profiles and the invite tree. All user SQL for reads lives here.

import { discordLinkFor } from './discord.ts'
import type { Db } from './index.ts'
import type { Member, TreeNode, TreeSummary, UserProfile, UserRef } from './types.ts'

interface UserRow {
  id: number
  login: string
  display_name: string | null
  bio: string
  bio_html: string
  created_at: number
  is_moderator: number
  banned: number
  invited_by: number | null
}

/** A member's profile by login (case-insensitive), or null. */
export function getProfile(db: Db, login: string): UserProfile | null {
  const row = db
    .query<UserRow, [string]>(
      `SELECT id, login, display_name, bio, bio_html, created_at, is_moderator, banned, invited_by
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
    bioHtml: row.bio_html,
    createdAt: row.created_at,
    isModerator: row.is_moderator === 1,
    banned: row.banned === 1,
    invitedBy: inviter ? ref(inviter) : null,
    invited: invited.map(ref),
    itemCount: counts?.items ?? 0,
    commentCount: counts?.comments ?? 0,
    discord: discordLinkFor(db, row.id),
  }
}

/** Every member as a forest: founding members at the roots, each with the people they invited. */
export function inviteTree(db: Db): TreeNode[] {
  const rows = db
    .query<UserRow, []>(
      `SELECT id, login, display_name, bio, bio_html, created_at, is_moderator, banned, invited_by
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

/**
 * A member's branch: the line of members who invited them, from a founding member down (not
 * including them), and their own node with everyone who joined through them. Null when the login
 * is not in the tree. Logins are compared exactly; resolve case first with `getProfile`.
 */
export function findBranch(
  roots: TreeNode[],
  login: string,
): { line: TreeNode[]; node: TreeNode } | null {
  const walk = (
    nodes: TreeNode[],
    line: TreeNode[],
  ): { line: TreeNode[]; node: TreeNode } | null => {
    for (const node of nodes) {
      if (node.login === login) return { line, node }
      const found = walk(node.children, [...line, node])
      if (found) return found
    }
    return null
  }
  return walk(roots, [])
}

/**
 * The invite tree in brief, for the front page: how many members, how long the longest chain of
 * invitations is, and the newest `limit` members (not banned) with who invited them.
 */
export function treeSummary(db: Db, limit: number): TreeSummary {
  const size = db
    .query<{ members: number; deepest: number | null }, []>(
      `WITH RECURSIVE chain (id, depth) AS (
         SELECT id, 0 FROM users WHERE invited_by IS NULL
         UNION ALL
         SELECT users.id, chain.depth + 1 FROM users JOIN chain ON users.invited_by = chain.id
         WHERE chain.depth < 1000
       )
       SELECT (SELECT count(*) FROM users) AS members, (SELECT max(depth) FROM chain) AS deepest`,
    )
    .get()
  const newest = db
    .query<{ login: string; created_at: number; inviter: string | null }, [number]>(
      `SELECT u.login, u.created_at, p.login AS inviter
       FROM users u LEFT JOIN users p ON p.id = u.invited_by
       WHERE u.banned = 0
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ?`,
    )
    .all(limit)
  return {
    members: size?.members ?? 0,
    deepest: size?.deepest ?? 0,
    newest: newest.map((row) => ({
      login: row.login,
      createdAt: row.created_at,
      invitedBy: row.inviter,
    })),
  }
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

/** A member account by GitHub id, banned or not. */
export function accountByGithubId(
  db: Db,
  githubId: number,
): { id: number; login: string; banned: boolean } | null {
  const row = db
    .query<{ id: number; login: string; banned: number }, [number]>(
      'SELECT id, login, banned FROM users WHERE github_id = ?',
    )
    .get(githubId)
  return row ? { id: row.id, login: row.login, banned: row.banned === 1 } : null
}

/** A member by login (case-insensitive), banned or not, with their GitHub id. */
export function accountByLogin(
  db: Db,
  login: string,
): (Member & { githubId: number | null; banned: boolean }) | null {
  const row = db
    .query<
      {
        id: number
        login: string
        display_name: string | null
        is_moderator: number
        github_id: number | null
        banned: number
      },
      [string]
    >('SELECT id, login, display_name, is_moderator, github_id, banned FROM users WHERE login = ?')
    .get(login)
  if (!row) return null
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    isModerator: row.is_moderator === 1,
    githubId: row.github_id,
    banned: row.banned === 1,
  }
}

/** What /settings edits. */
export function profileSettings(
  db: Db,
  userId: number,
): { displayName: string | null; bio: string } | null {
  const row = db
    .query<{ display_name: string | null; bio: string }, [number]>(
      'SELECT display_name, bio FROM users WHERE id = ?',
    )
    .get(userId)
  return row ? { displayName: row.display_name, bio: row.bio } : null
}

/** Members who could sign in through /dev/sign-in-as, for the development sign-in page. */
export function listDevAccounts(db: Db): { login: string; isModerator: boolean }[] {
  return db
    .query<{ login: string; is_moderator: number }, []>(
      'SELECT login, is_moderator FROM users WHERE banned = 0 ORDER BY is_moderator DESC, created_at',
    )
    .all()
    .map((row) => ({ login: row.login, isModerator: row.is_moderator === 1 }))
}
