import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { requireSameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { isConnectConfigured } from '@/lib/connect'
import { createCardUpdateSession } from '@/lib/connect-subscriptions'
import { env } from '@/lib/env'

// A client replaces the card on their recurring membership.
//
// This is the single most valuable button in the whole failure surface. Access
// stops on the FIRST failed payment, and most failures are an expired card — so
// this is the path from "my plan is paused" back to "everything works", and the
// webhook that completes it retries the outstanding invoice immediately rather
// than making them wait for Stripe's next scheduled attempt.
//
// Offered on the cancel screen too: most people looking for "cancel" are
// actually trying to fix a payment.
export async function POST(req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing a client's app must not be able to put a card on file.
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — disabled' }, { status: 403 })

  const { purchaseId } = await params

  const limited = await enforceRateLimit({ key: `update-card:${active.clientId}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  // Scoped by clientId, so this can only ever reach the caller's OWN
  // subscription — another client's id resolves to nothing and 404s.
  const purchase = await prisma.membershipPurchase.findFirst({
    where: { id: purchaseId, clientId: active.clientId },
    select: { id: true, trainerId: true, sandbox: true, stripeSubscriptionId: true, stripeCustomerId: true, status: true },
  })
  if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!purchase.stripeSubscriptionId || !purchase.stripeCustomerId) {
    return NextResponse.json({ error: 'This package isn’t a recurring plan.' }, { status: 409 })
  }
  // A finished plan has nothing left to charge, so there is no card to update.
  if (purchase.status === 'CANCELLED' || purchase.status === 'LAPSED' || purchase.status === 'ORPHANED') {
    return NextResponse.json({ error: 'This plan has ended.' }, { status: 409 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: purchase.trainerId },
    select: { connectAccountId: true },
  })
  if (!trainer?.connectAccountId) {
    return NextResponse.json({ error: 'Payments aren’t switched on for this trainer.' }, { status: 409 })
  }
  if (!isConnectConfigured(purchase.sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL
  const { url } = await createCardUpdateSession({
    connectAccountId: trainer.connectAccountId,
    sandbox: purchase.sandbox,
    customerId: purchase.stripeCustomerId,
    // Read back by the checkout.session.completed handler to know whose card
    // this is. The handler re-verifies the account and mode before acting on it.
    metadata: { membershipPurchaseId: purchase.id },
    successUrl: `${appUrl}/my-memberships?card=updated`,
    cancelUrl: `${appUrl}/my-memberships`,
  })
  if (!url) return NextResponse.json({ error: 'Could not start the card update' }, { status: 502 })
  return NextResponse.json({ ok: true, url }, { status: 201 })
}
