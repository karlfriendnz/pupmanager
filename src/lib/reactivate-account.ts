import { prisma } from '@/lib/prisma'

/**
 * Reactivate-on-return: when a previously deactivated ("inactive") account
 * successfully signs back in, clear the deactivation so they regain access
 * — rather than blocking the sign-in. Identity has already been proven by the
 * provider (credentials password / OAuth) before this runs.
 *
 * Best-effort: callers must never let this block the sign-in. Returns true if
 * an account was actually reactivated.
 */
export async function reactivateOnSignIn(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { deactivatedAt: true },
  })
  if (!u?.deactivatedAt) return false
  await prisma.user.update({
    where: { id: userId },
    data: { deactivatedAt: null },
  }).catch(() => {})
  return true
}
