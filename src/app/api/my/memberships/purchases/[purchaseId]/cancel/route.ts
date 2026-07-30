import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { requireSameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { cancelAtPeriodEnd } from '@/lib/connect-subscriptions'
import { notifyTrainer } from '@/lib/trainer-notify'

// A client cancels their own recurring membership, from inside the app.
//
// This is not optional and it is not negotiable. If a client has to email
// someone to stop a recurring payment we have built a dark pattern, and in
// several of our markets a legally non-compliant one — the EU/UK expect
// cancelling to be no harder than signing up, and California's click-to-cancel
// rules say the same.
//
// They keep the rest of the period they have already paid for: Stripe is asked
// to stop at the period end, not immediately, and there is no pro-rata refund.
export async function POST(req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer walking their own client's app must not be able to cancel a real
  // subscription from preview mode.
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — cancellation disabled' }, { status: 403 })

  const { purchaseId } = await params

  const limited = await enforceRateLimit({ key: `cancel-membership:${active.clientId}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  // Scoped by clientId, so this can only ever reach the caller's OWN
  // subscription — another client's id resolves to nothing and 404s rather than
  // 403ing, which would confirm the row exists.
  const purchase = await prisma.membershipPurchase.findFirst({
    where: { id: purchaseId, clientId: active.clientId },
    select: {
      id: true, trainerId: true, clientId: true, status: true, sandbox: true,
      stripeSubscriptionId: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
      membership: { select: { name: true } },
    },
  })
  if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!purchase.stripeSubscriptionId) {
    return NextResponse.json({ error: 'This package isn’t a recurring plan.' }, { status: 409 })
  }
  // Already stopping or stopped — say so rather than calling Stripe again.
  if (purchase.status === 'CANCELLED' || purchase.cancelAtPeriodEnd) {
    return NextResponse.json({ ok: true, alreadyCancelling: true, endsAt: purchase.currentPeriodEnd })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: purchase.trainerId },
    select: { connectAccountId: true, user: { select: { id: true } } },
  })
  if (!trainer?.connectAccountId) {
    return NextResponse.json({ error: 'Payments aren’t switched on for this trainer.' }, { status: 409 })
  }

  // Stripe first, our row second. If this throws we have NOT told the client
  // they are cancelled while their card keeps being charged — the single worst
  // failure this feature has, because it destroys trust in the trainer and is a
  // legal problem. Our row is never the source of truth.
  try {
    await cancelAtPeriodEnd({
      connectAccountId: trainer.connectAccountId,
      sandbox: purchase.sandbox,
      subscriptionId: purchase.stripeSubscriptionId,
    })
  } catch (err) {
    console.error('[membership cancel] stripe refused', purchase.stripeSubscriptionId, err)
    return NextResponse.json({ error: 'We couldn’t cancel that just now. Please try again.' }, { status: 502 })
  }

  const updated = await prisma.membershipPurchase.update({
    where: { id: purchase.id },
    data: {
      // CANCELLING, not CANCELLED — they still get everything until the date.
      // Stripe fires customer.subscription.deleted when the period actually
      // ends, and that is what moves them to CANCELLED.
      status: 'CANCELLING',
      cancelAtPeriodEnd: true,
      cancelledAt: new Date(),
      cancelReason: 'CLIENT_SELF_SERVE',
    },
    select: { currentPeriodEnd: true },
  })

  // A membership vanishing without a word is a support ticket every time.
  const client = await prisma.clientProfile.findUnique({
    where: { id: purchase.clientId },
    select: { user: { select: { name: true } }, dog: { select: { name: true } } },
  })
  if (trainer.user?.id) {
    await notifyTrainer(
      trainer.user.id,
      'CLIENT_SHOP_ORDER',
      {
        clientName: client?.user?.name ?? 'A client',
        dogName: client?.dog?.name ?? '',
        detail: `cancelled the ongoing plan “${purchase.membership?.name ?? 'a package'}”`,
      },
      `/clients/${purchase.clientId}`,
      purchase.trainerId,
    ).catch(err => console.error('[membership cancel] trainer notify failed', err))
  }

  return NextResponse.json({ ok: true, alreadyCancelling: false, endsAt: updated.currentPeriodEnd })
}
