import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createOnboardingLink } from '@/lib/connect'
import { env } from '@/lib/env'

// Account Links are single-use and short-lived. Stripe redirects the trainer's
// browser here if their onboarding link expires mid-flow; we mint a fresh one
// and bounce them straight back into Stripe-hosted onboarding.
export async function GET() {
  const settings = `${env.NEXT_PUBLIC_APP_URL}/settings?tab=payments`
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.redirect(settings)
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId },
    select: { connectAccountId: true, sandboxBilling: true },
  })
  if (!trainer?.connectAccountId) return NextResponse.redirect(settings)

  try {
    const url = await createOnboardingLink(trainer.connectAccountId, trainer.sandboxBilling)
    return NextResponse.redirect(url)
  } catch {
    return NextResponse.redirect(`${settings}&error=onboarding`)
  }
}
