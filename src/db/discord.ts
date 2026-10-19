// Members' Discord accounts (ADR 0009): linking, unlinking and looking one up.

import type { Db } from './index.ts'
import type { DiscordLink } from './types.ts'

interface LinkRow {
  discord_id: string
  username: string
  linked_at: number
}

const toLink = (row: LinkRow): DiscordLink => ({
  discordId: row.discord_id,
  username: row.username,
  linkedAt: row.linked_at,
})

/** The member's linked Discord account, or null. */
export function discordLinkFor(db: Db, userId: number): DiscordLink | null {
  const row = db
    .query<LinkRow, [number]>(
      'SELECT discord_id, username, linked_at FROM discord_links WHERE user_id = ?',
    )
    .get(userId)
  return row ? toLink(row) : null
}

/**
 * Link a Discord account to a member, replacing any account they had linked before. Refused with
 * `taken` when the Discord account is already linked to someone else.
 */
export function linkDiscord(
  db: Db,
  userId: number,
  account: { discordId: string; username: string },
  now: number,
): { ok: true } | { ok: false; reason: 'taken' } {
  return db.transaction(() => {
    const owner = db
      .query<{ user_id: number }, [string]>(
        'SELECT user_id FROM discord_links WHERE discord_id = ?',
      )
      .get(account.discordId)
    if (owner && owner.user_id !== userId) return { ok: false as const, reason: 'taken' as const }
    db.query(
      `INSERT INTO discord_links (user_id, discord_id, username, linked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET discord_id = excluded.discord_id,
         username = excluded.username, linked_at = excluded.linked_at`,
    ).run(userId, account.discordId, account.username, now)
    return { ok: true as const }
  })()
}

/** Remove the member's Discord link. True when there was one. */
export function unlinkDiscord(db: Db, userId: number): boolean {
  return db.query('DELETE FROM discord_links WHERE user_id = ?').run(userId).changes > 0
}
