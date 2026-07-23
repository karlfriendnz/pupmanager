import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLoginLink } from '@/lib/connect'

export const dynamic = 'force-dynamic'

// Hands the trainer off to their Stripe Express dashboard (payouts, balance,
// KYC). Stripe owns that surface for Express accounts, so we mint a single-use
// login link and redirect. Falls back to the payments settings when the account
// isn't set up. (A page — not an API route — so the Finances nav child can be a
// plain Link.)
export default async function StripeDashboardRedirect() {
  const settings = '/settings?tab=payments'
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) redirect(settings)

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId },
    select: { connectAccountId: true, sandboxBilling: true, connectChargesEnabled: true },
  })

  // Build the target BEFORE redirect() — redirect throws NEXT_REDIRECT, so it
  // must never sit inside the try/catch or the catch would swallow it.
  let url = settings
  if (trainer?.connectAccountId && trainer.connectChargesEnabled) {
    try {
      url = await createLoginLink(trainer.connectAccountId, trainer.sandboxBilling)
    } catch {
      url = `${settings}&error=dashboard`
    }
  }
  redirect(url)
}
