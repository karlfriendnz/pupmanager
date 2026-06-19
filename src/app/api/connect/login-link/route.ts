import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLoginLink } from '@/lib/connect'
import { env } from '@/lib/env'

// Redirect the trainer to their Stripe Express dashboard (payouts, balance,
// KYC self-service). Stripe owns this surface for Express accounts, so we just
// mint a single-use login link and hand them off.
export async function GET() {
  const settings = `${env.NEXT_PUBLIC_APP_URL}/settings?tab=payments`
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.redirect(settings)
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId },
    select: { connectAccountId: true, sandboxBilling: true, connectChargesEnabled: true },
  })
  // Login links only exist once the account has completed onboarding.
  if (!trainer?.connectAccountId || !trainer.connectChargesEnabled) {
    return NextResponse.redirect(settings)
  }

  try {
    const url = await createLoginLink(trainer.connectAccountId, trainer.sandboxBilling)
    return NextResponse.redirect(url)
  } catch {
    return NextResponse.redirect(`${settings}&error=dashboard`)
  }
}
