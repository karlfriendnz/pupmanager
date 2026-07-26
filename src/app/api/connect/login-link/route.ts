import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLoginLink } from '@/lib/connect'
import { env } from '@/lib/env'

// Redirect the trainer to their Stripe Express dashboard (payouts, balance,
// KYC self-service). Stripe owns this surface for Express accounts, so we just
// mint a single-use login link and hand them off.
//
// `?json=1` returns { url } instead of redirecting. That's for the native app:
// the OS browser has no app session, so it can't follow this route itself —
// the WebView (which does have the session) resolves the link here and then
// hands the real Stripe URL to the OS. Same auth, different envelope.
export async function GET(req: Request) {
  const json = new URL(req.url).searchParams.get('json') === '1'
  const settings = `${env.NEXT_PUBLIC_APP_URL}/settings?tab=payments`
  const fail = (status: number, error: string, redirectTo: string) =>
    json ? NextResponse.json({ error }, { status }) : NextResponse.redirect(redirectTo)

  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return fail(401, 'Not signed in as a trainer.', settings)
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId },
    select: { connectAccountId: true, sandboxBilling: true, connectChargesEnabled: true },
  })
  // Login links only exist once the account has completed onboarding.
  if (!trainer?.connectAccountId || !trainer.connectChargesEnabled) {
    return fail(400, 'Stripe setup isn’t finished yet.', settings)
  }

  try {
    const url = await createLoginLink(trainer.connectAccountId, trainer.sandboxBilling)
    return json ? NextResponse.json({ url }) : NextResponse.redirect(url)
  } catch {
    return fail(502, 'Couldn’t reach Stripe.', `${settings}&error=dashboard`)
  }
}
