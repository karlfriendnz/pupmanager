import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import {
  ensureCustomer,
  ensurePlanPrice,
  createSubscriptionCheckout,
  type PlanInterval,
} from '@/lib/connect-subscriptions'
import { describePlanCommitment, ensureConsent, findLiveSubscription } from '@/lib/membership-billing'
import { checkEligibility, describeMissing, type EligibilityMode } from '@/lib/membership-eligibility'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { hasAddon } from '@/lib/billing'
import { env } from '@/lib/env'

// A client buys a combo membership.
//
// ONE_OFF → one Connect checkout with a single MEMBERSHIP line; the webhook
// grants every included item on payment (unchanged).
//
// RECURRING → a Stripe Subscription on the trainer's connected account, sold
// against a MembershipPlan. The client must have seen and ticked the consent
// screen first: this route re-derives the exact same wording server-side and
// stores it verbatim before redirecting, so what we hold is never whatever the
// browser claimed it showed.
//
// Recurring is gated on TrainerProfile.recurringPaymentsEnabled — the old
// CONNECT_LIVE_ALLOWLIST env var is gone, so that column is the allowlist.
export async function POST(req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — purchase disabled' }, { status: 403 })
  const { membershipId } = await params

  const limited = await enforceRateLimit({ key: `buy-membership:${active.clientId}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, user: { select: { email: true, name: true } } },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // The trainer's Memberships add-on must be on — a switched-off trainer sells
  // nothing, even to someone holding an old link.
  if (!(await hasAddon(profile.trainerId, 'memberships'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Tenant-scoped: a membership id belonging to another trainer resolves to
  // nothing and 404s, so this can never reach across businesses.
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, trainerId: profile.trainerId, published: true },
    select: {
      id: true, name: true, priceCents: true, cadence: true, interval: true, eligibility: true,
      // Archived plans keep billing their existing subscribers but can never be
      // sold again — a new subscription always uses a current plan.
      plans: { where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, interval: true, priceCents: true, minTermCount: true, earlyTermFeeCents: true } },
    },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ─── ELIGIBILITY ──────────────────────────────────────────────────────────
  // The gate, re-derived here from the database. The storefront's copy of this
  // answer is a rendering hint; a POST straight at this route is exactly the
  // case it would not stop. Applies to one-off and recurring alike — a ladder
  // that only held for subscriptions would be no ladder at all.
  //
  // `subscribed` is passed so someone already on the package is never locked
  // out of it by a prerequisite added after they joined.
  const alreadyOn = await findLiveSubscription(profile.id, membership.id)
  const gate = await checkEligibility({
    membershipId: membership.id,
    clientId: profile.id,
    mode: membership.eligibility as EligibilityMode,
    subscribed: !!alreadyOn,
  })
  if (!gate.eligible) {
    const missing = await describeMissing(gate.missing)
    return NextResponse.json(
      {
        error:
          gate.lockedReason === 'INVITE_ONLY'
            ? 'This one is by invitation from your trainer.'
            : missing.length
              ? `You need ${missing.join(' and ')} before you can join this.`
              : 'You can’t join this one yet.',
        lockedReason: gate.lockedReason,
      },
      { status: 403 },
    )
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: {
      acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true,
      payoutCurrency: true, sandboxBilling: true, businessName: true,
      recurringPaymentsEnabled: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'Payments aren’t switched on yet.' }, { status: 409 })
  }
  const sandbox = trainer.sandboxBilling
  const currency = trainer.payoutCurrency ?? 'nzd'
  const appUrl = env.NEXT_PUBLIC_APP_URL

  // NOTE ON ORDERING: the REQUEST is validated (is this plan sellable, did they
  // agree, are they already subscribed) before the SERVER's Stripe config is
  // checked. A client who hasn't ticked the box should be told that, not handed
  // a 503 about our keys — and it keeps the guard responses deterministic
  // whether or not Stripe happens to be configured in a given environment.

  // ─── RECURRING ────────────────────────────────────────────────────────────
  if (membership.cadence === 'RECURRING') {
    if (!trainer.recurringPaymentsEnabled) {
      return NextResponse.json(
        { error: 'This is an ongoing plan — your trainer needs to set it up for you.' },
        { status: 409 },
      )
    }

    let body: { planId?: unknown; consent?: unknown } = {}
    try {
      body = await req.json()
    } catch {
      // No body — falls through to the "consent not given" refusal below.
    }

    // Every recurring membership has at least one plan (the migration backfilled
    // one for those that carried their price directly), so plans are the ONLY
    // thing a subscription is ever sold against — one code path through money.
    const plan = typeof body.planId === 'string'
      ? membership.plans.find(p => p.id === body.planId)
      : membership.plans[0]
    if (!plan) return NextResponse.json({ error: 'That billing option isn’t available.' }, { status: 409 })
    if (plan.priceCents <= 0) return NextResponse.json({ error: 'This package has no price set.' }, { status: 409 })

    // Consent is not a formality — it is the client's recorded permission to
    // take money while nobody is watching, and it must be explicit.
    if (body.consent !== true) {
      return NextResponse.json({ error: 'Please agree to the payment terms first.' }, { status: 400 })
    }

    // One live subscription per client per membership. Without this, a second
    // Subscribe stacks a second recurring charge on the same plan. (Resolved
    // above for the eligibility check — the same row, not a second query.)
    const live = alreadyOn
    if (live) {
      return NextResponse.json({ error: 'You’re already on this plan.' }, { status: 409 })
    }

    // Everything about the request checks out; now the server must be able to
    // talk to Stripe at all.
    if (!isConnectConfigured(sandbox)) {
      return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
    }

    const interval = plan.interval as PlanInterval
    // Re-derived server-side. The browser does not get to tell us what it showed.
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
      membershipId: membership.id,
      planId: plan.id,
      priceCents: plan.priceCents,
      currency,
      interval,
      consentText: commitment.consentText,
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    })

    const [customerId, priceId] = await Promise.all([
      ensureCustomer({
        clientId: profile.id,
        connectAccountId: trainer.connectAccountId,
        sandbox,
        email: profile.user?.email,
        name: profile.user?.name,
      }),
      ensurePlanPrice({
        planId: plan.id,
        connectAccountId: trainer.connectAccountId,
        sandbox,
        productName: membership.name,
      }),
    ])

    const { url } = await createSubscriptionCheckout({
      connectAccountId: trainer.connectAccountId,
      sandbox,
      customerId,
      priceId,
      currency,
      subscriptionMetadata: {
        membershipId: membership.id,
        trainerId: profile.trainerId,
        clientId: profile.id,
        planId: plan.id,
        consentId: consent.id,
      },
      successUrl: `${appUrl}/my-memberships?subscribed=1`,
      cancelUrl: `${appUrl}/my-memberships?cancelled=1`,
      // Anchored on the reused consent row, so a double-tapped Subscribe
      // collapses into ONE subscription instead of billing them twice forever.
      idempotencyKey: `subcheckout:${consent.id}`,
    })
    if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
    return NextResponse.json({ ok: true, mode: 'subscription', url }, { status: 201 })
  }

  // ─── ONE_OFF ──────────────────────────────────────────────────────────────
  if (membership.priceCents <= 0) {
    return NextResponse.json({ error: 'This package has no price set.' }, { status: 409 })
  }
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: profile.trainerId,
    connectAccountId: trainer.connectAccountId,
    clientId: profile.id,
    currency,
    description: membership.name,
    lines: [{ kind: 'MEMBERSHIP', description: membership.name, unitAmount: membership.priceCents, quantity: 1, intent: { membershipId: membership.id } }],
    successUrl: `${appUrl}/my-sessions?membership=1`,
    cancelUrl: `${appUrl}/my-memberships?cancelled=1`,
  })
  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
}
