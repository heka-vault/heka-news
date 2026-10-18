// Invitations (ADR 0003, 0007): single-use links. Only the SHA-256 of the code is stored, so a
// link can be shown once, when it is made, and never again.

import type { Db } from './index.ts'
import type { InviteRow, InviteStatus, UserRef } from './types.ts'

interface Row {
  id: number
  inviter_login: string
  inviter_name: string | null
  note: string | null
  created_at: number
  expires_at: number
  used_at: number | null
  revoked_at: number | null
  used_login: string | null
  used_name: string | null
}

const COLUMNS = `v.id, iu.login AS inviter_login, iu.display_name AS inviter_name, v.note,
  v.created_at, v.expires_at, v.used_at, v.revoked_at, uu.login AS used_login,
  uu.display_name AS used_name`

const FROM = `FROM invites v JOIN users iu ON iu.id = v.inviter_id
  LEFT JOIN users uu ON uu.id = v.used_by`

function status(row: Row, now: number): InviteStatus {
  if (row.used_at !== null) return 'used'
  if (row.revoked_at !== null) return 'revoked'
  if (row.expires_at <= now) return 'expired'
  return 'open'
}

function toInvite(row: Row, now: number): InviteRow {
  const usedBy: UserRef | null = row.used_login
    ? { login: row.used_login, displayName: row.used_name }
    : null
  return {
    id: row.id,
    inviter: { login: row.inviter_login, displayName: row.inviter_name },
    note: row.note ?? '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: status(row, now),
    usedBy,
    usedAt: row.used_at,
  }
}

export function createInvite(
  db: Db,
  invite: { inviterId: number; codeHash: string; note: string; now: number; ttl: number },
): number {
  const row = db
    .query<{ id: number }, [string, number, string | null, number, number]>(
      `INSERT INTO invites (code_hash, inviter_id, note, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      invite.codeHash,
      invite.inviterId,
      invite.note || null,
      invite.now,
      invite.now + invite.ttl,
    )
  if (!row) throw new Error('could not create the invitation')
  return row.id
}

/** An invitation by the hash of its code, whatever its status. */
export function inviteByHash(db: Db, codeHash: string, now: number): InviteRow | null {
  const row = db
    .query<Row, [string]>(`SELECT ${COLUMNS} ${FROM} WHERE v.code_hash = ?`)
    .get(codeHash)
  return row ? toInvite(row, now) : null
}

export function getInvite(
  db: Db,
  id: number,
  now: number,
): (InviteRow & { inviterId: number }) | null {
  const row = db
    .query<Row & { inviter_id: number }, [number]>(
      `SELECT ${COLUMNS}, v.inviter_id ${FROM} WHERE v.id = ?`,
    )
    .get(id)
  return row ? { ...toInvite(row, now), inviterId: row.inviter_id } : null
}

/** A member's invitations, newest first. */
export function listInvitesBy(db: Db, inviterId: number, now: number): InviteRow[] {
  return db
    .query<Row, [number]>(
      `SELECT ${COLUMNS} ${FROM} WHERE v.inviter_id = ? ORDER BY v.created_at DESC, v.id DESC`,
    )
    .all(inviterId)
    .map((row) => toInvite(row, now))
}

/** Every invitation that could still be redeemed, oldest first: for moderators. */
export function listOpenInvites(db: Db, now: number): InviteRow[] {
  return db
    .query<Row, [number]>(
      `SELECT ${COLUMNS} ${FROM}
       WHERE v.used_at IS NULL AND v.revoked_at IS NULL AND v.expires_at > ?
       ORDER BY v.created_at, v.id`,
    )
    .all(now)
    .map((row) => toInvite(row, now))
}

/** Revoke an open invitation. False if it was already used, revoked or expired. */
export function revokeInvite(db: Db, id: number, now: number): boolean {
  return (
    db
      .query(
        `UPDATE invites SET revoked_at = ?
         WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(now, id, now).changes === 1
  )
}

/** Revoke every open invitation a member made (when they are banned). */
export function revokeInvitesBy(db: Db, inviterId: number, now: number): number {
  return db
    .query(
      `UPDATE invites SET revoked_at = ?
       WHERE inviter_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .run(now, inviterId, now).changes
}
