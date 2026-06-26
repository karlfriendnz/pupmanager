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
