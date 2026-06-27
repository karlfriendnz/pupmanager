import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '@/lib/env'

// Stateless unsubscribe tokens for mailing-list subscribers (lead-magnet
// sign-ups). Mirrors unsubscribe-token.ts but namespaced ("sub:") so a client
// token can't be replayed as a subscriber token or vice versa.

function sign(subscriberId: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`sub:${subscriberId}`).digest('base64url')
}

export function makeSubscriberUnsubToken(subscriberId: string): string {
  const id = Buffer.from(subscriberId, 'utf8').toString('base64url')
  return `${id}.${sign(subscriberId)}`
}

export function verifySubscriberUnsubToken(token: string): string | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const idPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  let subscriberId: string
  try {
    subscriberId = Buffer.from(idPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!subscriberId) return null

  const expected = sign(subscriberId)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return subscriberId
}

export function subscriberUnsubscribeUrl(subscriberId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/unsubscribe/subscriber/${makeSubscriberUnsubToken(subscriberId)}`
}
