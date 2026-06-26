'use server'

import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

// Re-opt-in, for clients who unsubscribed by mistake. Token-gated exactly like
// the opt-out so no auth/session is needed on this public page.
export async function resubscribe(token: string): Promise<{ ok: boolean }> {
  const clientProfileId = verifyUnsubscribeToken(token)
  if (!clientProfileId) return { ok: false }
  const res = await prisma.clientProfile.updateMany({
    where: { id: clientProfileId },
    data: { marketingEmailOptOut: false, marketingOptOutAt: null, marketingOptOutReason: null },
  })
  return { ok: res.count > 0 }
}
