'use server'

import { prisma } from '@/lib/prisma'
import { verifySubscriberUnsubToken } from '@/lib/subscriber-unsubscribe-token'

// Re-opt-in for a subscriber who unsubscribed by mistake. Token-gated exactly
// like the opt-out, so no auth/session is needed on this public page.
export async function resubscribeSubscriber(token: string): Promise<{ ok: boolean }> {
  const subscriberId = verifySubscriberUnsubToken(token)
  if (!subscriberId) return { ok: false }
  const res = await prisma.subscriber.updateMany({
    where: { id: subscriberId },
    data: { status: 'SUBSCRIBED', unsubscribedAt: null },
  })
  return { ok: res.count > 0 }
}
