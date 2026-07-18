import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '@/lib/env'

// Opaque, tamper-proof unsubscribe tokens for bulk-email footers. We sign the
// clientProfileId with HMAC-SHA256(AUTH_SECRET) rather than store a per-client
// token column — the token is verifiable statelessly and can't be guessed or
// mutated to target another client's record.

function sign(clientProfileId: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(clientProfileId).digest('base64url')
}

export function makeUnsubscribeToken(clientProfileId: string): string {
  const id = Buffer.from(clientProfileId, 'utf8').toString('base64url')
  return `${id}.${sign(clientProfileId)}`
}

// Returns the clientProfileId if the token is well-formed and the signature
// matches, else null. Constant-time signature comparison.
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const idPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  let clientProfileId: string
  try {
    clientProfileId = Buffer.from(idPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!clientProfileId) return null

  const expected = sign(clientProfileId)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return clientProfileId
}

// Absolute unsubscribe URL embedded in the email footer.
export function unsubscribeUrl(clientProfileId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/unsubscribe/${makeUnsubscribeToken(clientProfileId)}`
}

// ── Product-update ("what's new") email unsubscribe — keyed on User.id ───────
// A separate, namespaced token so a client marketing-unsubscribe token can never
// be replayed as a product-email unsubscribe (or vice versa). Sets
// User.productEmailOptOut. Works for any user (trainer or client).
function signUser(userId: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`product:${userId}`).digest('base64url')
}

export function makeProductUnsubscribeToken(userId: string): string {
  const id = Buffer.from(userId, 'utf8').toString('base64url')
  return `${id}.${signUser(userId)}`
}

export function verifyProductUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const idPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  let userId: string
  try {
    userId = Buffer.from(idPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!userId) return null

  const expected = signUser(userId)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return userId
}

export function productUnsubscribeUrl(userId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/unsubscribe/updates/${makeProductUnsubscribeToken(userId)}`
}
