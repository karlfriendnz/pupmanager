import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { isConnectConfigured } from '@/lib/connect'
import {
  ensurePlanPrice,
  switchSubscriptionPrice,
  periodFromSubscription,
  mapSubscriptionStatus,
  addCycles,
  type PlanInterval,
} from '@/lib/connect-subscriptions'
import { describePlanCommitment, ensureConsent } from '@/lib/membership-billing'
import { checkEligibility, describeMissing, type EligibilityMode } from '@/lib/membership-eligibility'
import { fulfilMembershipInTx, enrolMembershipClasses } from '@/lib/memberships'
import { suspendMembershipGrants } from '@/lib/membership-access'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { hasAddon } from '@/lib/billing'

// Move from one recurring package to another — the rung-to-rung step.
//
// This is NOT "cancel then buy". Cancelling and re-subscribing would charge a
// full fresh period on the day of the change, reset the billing anchor, and
// briefly leave two live subscriptions on one client, which is the precise
// shape that produced a double charge in July. Instead the existing Stripe
// Subscription is re-priced in place and the purchase row is closed and
// reopened against the new package.
//
// WHY A NEW PURCHASE ROW RATHER THAN AN EDIT. Invoices hang off the purchase.
// Moving `membershipId` on the existing row would silently re-file every
// payment they ever made for Juniors under Seniors, so their billing history
// would describe a package they were not on at the time. The old row is closed
// with its invoices intact and the subscription id is handed to the new one —
// `stripeSubscriptionId` is unique, and it is what every later webhook resolves
// through, so exactly one row may hold it.
//
// WHAT IT REFUSES
//
//   * a target they are not eligible for — the whole point of the ladder is
//     that it cannot be climbed by switching instead of buying
//   * a downgrade inside a minimum term they committed to
//   * anything that is not recurring→recurring
//   * the package they are already on
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — switching disabled' }, { status: 403 })
  const { membershipId } = await params

  const limited = await enforceRateLimit({ key: `switch-membership:${active.clientId}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  if (!(await hasAddon(profile.trainerId, 'memberships'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { planId?: unknown; consent?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // No body — the consent refusal below is the right answer.
  }

  // ─── The package they want ────────────────────────────────────────────────
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, trainerId: profile.trainerId, published: true },
    select: {
      id: true, name: true, cadence: true, eligibility: true,
      plans: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        select: { id: true, interval: true, priceCents: true, minTermCount: true, earlyTermFeeCents: true },
      },
    },
  })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.cadence !== 'RECURRING') {
    return NextResponse.json({ error: 'That package isn’t an ongoing plan.' }, { status: 409 })
  }

  // ─── The plan they're on now ──────────────────────────────────────────────
  const current = await prisma.membershipPurchase.findFirst({
    where: {
      clientId: profile.id,
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      stripeSubscriptionId: { not: null },
    },
    orderBy: { purchasedAt: 'desc' },
    select: {
      id: true, membershipId: true, stripeSubscriptionId: true, stripeCustomerId: true,
      committedUntil: true, sandbox: true,
      plan: { select: { priceCents: true, interval: true } },
      membership: { select: { name: true } },
    },
  })
  if (!current?.stripeSubscriptionId) {
    return NextResponse.json({ error: 'You’re not on an ongoing plan to switch from.' }, { status: 409 })
  }
  if (current.membershipId === target.id) {
    return NextResponse.json({ error: 'You’re already on this one.' }, { status: 409 })
  }
  // CANCELLING is deliberately excluded above: someone who has asked to stop
  // should not be quietly resubscribed to something else by a switch. They can
  // resume, then switch.

  const plan = typeof body.planId === 'string'
    ? target.plans.find(p => p.id === body.planId)
    : target.plans[0]
  if (!plan) return NextResponse.json({ error: 'That billing option isn’t available.' }, { status: 409 })
  if (plan.priceCents <= 0) return NextResponse.json({ error: 'This package has no price set.' }, { status: 409 })

  // ─── The ladder ───────────────────────────────────────────────────────────
  // `subscribed: false` — they are not on the TARGET, and being on a different
  // package is not a reason to be let into this one.
  const gate = await checkEligibility({
    membershipId: target.id,
    clientId: profile.id,
    mode: target.eligibility as EligibilityMode,
    subscribed: false,
  })
  if (!gate.eligible) {
    const missing = await describeMissing(gate.missing)
    return NextResponse.json(
      {
        error:
          gate.lockedReason === 'INVITE_ONLY'
            ? 'This one is by invitation from your trainer.'
            : missing.length
              ? `You need ${missing.join(' and ')} before you can move up to this.`
              : 'You can’t move to this one yet.',
        lockedReason: gate.lockedReason,
      },
      { status: 403 },
    )
  }

  // ─── The commitment they already made ─────────────────────────────────────
  // Paying MORE is always allowed, minimum term or not — nobody is harmed by
  // it and it is the case this feature exists for. Paying LESS inside a term
  // they signed up to is the thing the term means, so it is refused here rather
  // than quietly honoured.
  const currentPrice = current.plan?.priceCents ?? 0
  const isUpgrade = plan.priceCents > currentPrice
  const stillCommitted = current.committedUntil && current.committedUntil.getTime() > Date.now()
  if (!isUpgrade && stillCommitted) {
    return NextResponse.json(
      {
        error:
          `You’re committed to ${current.membership?.name ?? 'your current plan'} until ` +
          `${current.committedUntil!.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
          `Ask your trainer if you'd like to move down sooner.`,
      },
      { status: 409 },
    )
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: {
      connectAccountId: true, connectChargesEnabled: true, acceptPaymentsEnabled: true,
      recurringPaymentsEnabled: true, sandboxBilling: true, payoutCurrency: true, businessName: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'Payments aren’t switched on yet.' }, { status: 409 })
  }
  if (!trainer.recurringPaymentsEnabled) {
    return NextResponse.json({ error: 'Ongoing plans aren’t switched on yet.' }, { status: 409 })
  }
  const sandbox = trainer.sandboxBilling
  const currency = trainer.payoutCurrency ?? 'nzd'
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  // ─── Consent ──────────────────────────────────────────────────────────────
  // A different price at a different frequency is a DIFFERENT agreement, so it
  // needs its own recorded permission — re-derived server-side, never taken
  // from whatever the browser claims it displayed.
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Please agree to the new payment terms first.' }, { status: 400 })
  }
  const interval = plan.interval as PlanInterval
  const commitment = describePlanCommitment({
    businessName: trainer.businessName ?? 'Your trainer',
    priceCents: plan.priceCents,
    currency,
    interval,
    minTermCount: plan.minTermCount,
    earlyTermFeeCents: plan.earlyTermFeeCents,
  })
  const consent = await ensureConsent({
    clientId: profile.id,
    membershipId: target.id,
    planId: plan.id,
    priceCents: plan.priceCents,
    currency,
    interval,
    consentText: commitment.consentText,
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
  })

  // ─── Stripe first ─────────────────────────────────────────────────────────
  // Money before bookkeeping, deliberately. If Stripe refuses, nothing here has
  // been written and the client is exactly where they were. If the writes below
  // fail after Stripe succeeded, they are on the new price with the old package
  // recorded — visible, wrong in one direction only, and fixed by retrying.
  const priceId = await ensurePlanPrice({
    planId: plan.id,
    connectAccountId: trainer.connectAccountId,
    sandbox,
    productName: target.name,
  })

  let sub
  try {
    sub = await switchSubscriptionPrice({
      subscriptionId: current.stripeSubscriptionId,
      newPriceId: priceId,
      connectAccountId: trainer.connectAccountId,
      sandbox,
      currency,
      isUpgrade,
      metadata: {
        membershipId: target.id,
        trainerId: profile.trainerId,
        clientId: profile.id,
        planId: plan.id,
        consentId: consent.id,
      },
      idempotencyKey: `subswitch:${consent.id}`,
    })
  } catch (err) {
    console.error('[memberships] switch failed at Stripe', {
      from: current.membershipId, to: target.id, clientId: profile.id, err,
    })
    return NextResponse.json({ error: 'Could not change your plan. Please try again.' }, { status: 502 })
  }

  // ─── Then our side ────────────────────────────────────────────────────────
  const { start, end } = periodFromSubscription(sub)
  const status = mapSubscriptionStatus(sub)
  const committedUntil = plan.minTermCount > 0 && start
    ? addCycles(start, interval, plan.minTermCount)
    : null

  let classGrants: { classRunId: string }[] = []
  let newPurchaseId: string | null = null

  await prisma.$transaction(async (tx) => {
    // Close the old row. The subscription id has to come off it before the new
    // row can take it — the column is unique, and it must point at whichever
    // purchase the next webhook should update.
    await tx.membershipPurchase.update({
      where: { id: current.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `Switched to ${target.name}`,
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
      },
    })
    // Stop what the old package was giving them. Suspend rather than delete:
    // the grants stay attached to the closed purchase, so the record of what
    // they had on that plan survives.
    await suspendMembershipGrants(tx, current.id)

    const res = await fulfilMembershipInTx(tx, {
      membershipId: target.id,
      trainerId: profile.trainerId,
      clientId: profile.id,
      // No Payment row: the money for this change is a proration on the
      // subscription's own invoice, which invoice.paid records in the usual way.
      paymentId: null,
      sandbox,
      recurring: {
        planId: plan.id,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: current.stripeCustomerId,
        status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        committedUntil,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        applicationFeePercent: sub.application_fee_percent ?? null,
      },
    })
    classGrants = res.classGrants
    newPurchaseId = res.membershipPurchaseId

    await tx.membershipConsent.updateMany({
      where: { id: consent.id, stripeSubscriptionId: null },
      data: { stripeSubscriptionId: sub.id },
    })
  })

  // Class places are enrolled outside the transaction, the same way the initial
  // subscribe path does it — enrolInRun opens its own.
  if (classGrants.length) {
    await enrolMembershipClasses(classGrants, profile.id, newPurchaseId)
  }

  return NextResponse.json({
    ok: true,
    from: current.membership?.name ?? null,
    to: target.name,
    isUpgrade,
    // An upgrade is invoiced immediately for the rest of the period; a
    // downgrade leaves credit against the next bill. The caller says which.
    prorationCharged: isUpgrade,
  })
}
