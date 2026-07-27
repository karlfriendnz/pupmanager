import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { cancelAtPeriodEnd, cancelSubscriptionNow } from '@/lib/connect-subscriptions'
import { suspendMembershipGrants } from '@/lib/membership-access'
import { notifyClient } from '@/lib/client-notify'

// A trainer stops one of their clients' ongoing plans.
//
// Two shapes, and the default matters: `atPeriodEnd` (the default) lets the
// client keep what they have already paid for, which is the same promise the
// client's own cancel screen makes. `now` cuts it immediately and is only for
// the cases where continuing would be worse — a dispute, or a client who has
// asked to stop today.
//
// Either way the CLIENT IS TOLD. A membership vanishing without a word is a
// support ticket every single time, and it is the trainer's relationship that
// pays for it.
const schema = z.object({
  mode: z.enum(['atPeriodEnd', 'now']).optional(),
  reason: z.string().max(500).optional(),
}).optional()

export async function POST(req: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  // Same permission that governs building and pricing packages.
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const trainerId = ctx.companyId
  const { purchaseId } = await params

  const limited = await enforceRateLimit({ key: `trainer-cancel-sub:${trainerId}`, limit: 30, windowMs: 10 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const mode = parsed.data?.mode ?? 'atPeriodEnd'

  // Scoped to the caller's OWN business — another trainer's subscription
  // resolves to nothing and 404s rather than 403ing, which would confirm it
  // exists.
  const purchase = await prisma.membershipPurchase.findFirst({
    where: { id: purchaseId, trainerId },
    select: {
      id: true, clientId: true, membershipId: true, status: true, sandbox: true,
      stripeSubscriptionId: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
      membership: { select: { name: true } },
    },
  })
  if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!purchase.stripeSubscriptionId) {
    return NextResponse.json({ error: 'This purchase isn’t a recurring plan.' }, { status: 409 })
  }
  if (purchase.status === 'CANCELLED' || purchase.status === 'ORPHANED') {
    return NextResponse.json({ ok: true, alreadyEnded: true })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { connectAccountId: true, businessName: true },
  })
  if (!trainer?.connectAccountId) {
    return NextResponse.json({ error: 'Payments aren’t switched on.' }, { status: 409 })
  }

  // Stripe first. If we marked our row and Stripe kept billing, the client
  // would be charged for a plan both sides had told them was over.
  try {
    if (mode === 'now') {
      await cancelSubscriptionNow({
        connectAccountId: trainer.connectAccountId,
        sandbox: purchase.sandbox,
        subscriptionId: purchase.stripeSubscriptionId,
      })
    } else {
      await cancelAtPeriodEnd({
        connectAccountId: trainer.connectAccountId,
        sandbox: purchase.sandbox,
        subscriptionId: purchase.stripeSubscriptionId,
      })
    }
  } catch (err) {
    console.error('[trainer cancel sub] stripe refused', purchase.stripeSubscriptionId, err)
    return NextResponse.json({ error: 'We couldn’t cancel that just now. Please try again.' }, { status: 502 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.membershipPurchase.update({
      where: { id: purchase.id },
      data: {
        status: mode === 'now' ? 'CANCELLED' : 'CANCELLING',
        cancelAtPeriodEnd: mode !== 'now',
        cancelledAt: new Date(),
        cancelReason: parsed.data?.reason?.trim() || 'TRAINER_CANCELLED',
        ...(mode === 'now' ? { accessPausedAt: new Date() } : {}),
      },
    })
    // Cancelling NOW takes the benefits away now. Cancelling at the period end
    // deliberately leaves them alone — the client keeps everything until the
    // date, and customer.subscription.deleted pauses them when it arrives.
    if (mode === 'now') await suspendMembershipGrants(tx, purchase.id)
  })

  const client = await prisma.clientProfile.findUnique({
    where: { id: purchase.clientId },
    select: { user: { select: { id: true } }, dog: { select: { name: true } } },
  })
  if (client?.user?.id) {
    const endsOn = purchase.currentPeriodEnd
    await notifyClient({
      userId: client.user.id,
      trainerId,
      type: 'CLIENT_ADDED_TO_PLAN',
      vars: {
        trainerName: trainer.businessName ?? 'Your trainer',
        dogName: client.dog?.name ?? '',
        planName: purchase.membership?.name ?? 'your plan',
        detail: mode === 'now'
          ? 'This plan has been stopped. You won’t be charged again.'
          : endsOn
            ? `This plan won’t renew. You’ll keep it until ${endsOn.toLocaleDateString('en-NZ')}.`
            : 'This plan won’t renew again.',
      },
      link: '/my-memberships',
      ctaLabel: 'View your plans',
    }).catch(err => console.error('[trainer cancel sub] client notify failed', err))
  }

  return NextResponse.json({ ok: true, mode, endsAt: mode === 'now' ? null : purchase.currentPeriodEnd })
}
