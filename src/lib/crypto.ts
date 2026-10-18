// Small crypto helpers: random tokens, hashes, HMAC signatures and a constant-time compare. Used
// by sessions, invitations, OAuth state and CSRF tokens (ADR 0007).

import { createHmac, timingSafeEqual } from 'node:crypto'

/** `bytes` random bytes as base64url (32 bytes: 43 characters; 16 bytes: 22). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Buffer.from(buf).toString('base64url')
}

/** SHA-256 of a string, hex. What is stored for session and invitation tokens. */
export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

/** SHA-256 of a string, base64url. The PKCE challenge. */
export function sha256Base64Url(value: string): string {
  return Buffer.from(new Bun.CryptoHasher('sha256').update(value).digest()).toString('base64url')
}

/** HMAC-SHA256 of `data` under `secret`, base64url. `purpose` separates uses of one secret. */
export function hmac(secret: string, purpose: string, data: string): string {
  return createHmac('sha256', secret).update(`${purpose}\n${data}`).digest('base64url')
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
