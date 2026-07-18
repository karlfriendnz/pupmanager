'use server'

import { prisma } from '@/lib/prisma'
import { verifyProductUnsubscribeToken } from '@/lib/unsubscribe-token'

// Re-opt-in to product-update emails, for users who unsubscribed by mistake.
// Token-gated exactly like the opt-out so no auth/session is needed here.
export async function resubscribeProduct(token: string): Promise<{ ok: boolean }> {
  const userId = verifyProductUnsubscribeToken(token)
  if (!userId) return { ok: false }
  const res = await prisma.user.updateMany({
    where: { id: userId },
    data: { productEmailOptOut: false },
  })
  return { ok: res.count > 0 }
}
