import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'
import { loadPriceIndex } from '@/lib/billing'

// Receives Stripe events for subscription lifecycle. The signature header
// gates everything — without env.STRIPE_WEBHOOK_SECRET we 503 instead of
// silently accepting unverified payloads, since a misconfigured webhook
// in prod would let any caller flip subscriptionStatus.
//
// Events we care about (others are 200'd with no-op so Stripe doesn't
// retry forever):
//   - checkout.session.completed:        first-time activation, links sub→trainer
//   - customer.subscription.updated:     plan change, renewal, past_due, etc.
//   - customer.subscription.deleted:     cancellation
export async function POST(req: Request) {
  // Dual-mode: a live event validates against STRIPE_WEBHOOK_SECRET; a sandbox
  // (demo) event validates against STRIPE_WEBHOOK_SECRET_TEST. Try each
  // configured secret — whichever verifies tells us which Stripe mode the
  // event is from, so downstream calls use the matching key + price columns.
  const candidates: { secret: string; sandbox: boolean }[] = []
  if (env.STRIPE_WEBHOOK_SECRET && isStripeConfigured(false)) candidates.push({ secret: env.STRIPE_WEBHOOK_SECRET, sandbox: false })
  if (env.STRIPE_WEBHOOK_SECRET_TEST && isStripeConfigured(true)) candidates.push({ secret: env.STRIPE_WEBHOOK_SECRET_TEST, sandbox: true })
  if (!candidates.length) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Stripe's signature verification needs the raw body bytes, so we read
  // the request as text — the Next.js App Router gives us the unparsed
  // body via .text() before any JSON middleware touches it.
  const raw = await req.text()

  let event: Stripe.Event | null = null
  let sandbox = false
  for (const c of candidates) {
    try {
      event = stripeFor(c.sandbox).webhooks.constructEvent(raw, sig, c.secret)
      sandbox = c.sandbox
      break
    } catch {
      // not this secret — try the next
    }
  }
  if (!event) {
    console.error('[stripe webhook] signature verification failed for all configured secrets')
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(session, sandbox)
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(sub, event.type === 'customer.subscription.deleted', sandbox)
        break
      }
      default:
        // Silent ack — Stripe is fine with us not handling every event,
        // it just won't retry once we 200.
        break
    }
  } catch (err) {
    console.error('[stripe webhook]', event.type, err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, sandbox: boolean) {
  const trainerId = session.metadata?.trainerId
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

  if (!trainerId || !subscriptionId) {
    console.warn('[stripe webhook] checkout.session.completed missing trainerId or subscription', { trainerId, subscriptionId })
    return
  }

  // Pull the actual subscription so we can write the canonical period end,
  // status, and the full set of line items (core + seats + add-ons).
  const sub = await stripeFor(sandbox).subscriptions.retrieve(subscriptionId)
  const recon = await reconcileSubscriptionItems(sub, sandbox)

  // Founders Circle: stamp the seat here (not at checkout creation) so an
  // abandoned checkout never burns one. Only on the first completion — a
  // duplicate webhook must not move founderClaimedAt. Eligibility was
  // decided server-side when the session was created; we just honour the
  // flag Stripe echoes back in metadata.
  const founderStamp =
    session.metadata?.founder === 'true'
      ? await prisma.trainerProfile
          .findUnique({ where: { id: trainerId }, select: { isFounder: true } })
          .then(t => (t && !t.isFounder ? { isFounder: true, founderClaimedAt: new Date() } : {}))
      : {}

  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: mapStripeStatus(sub.status),
      ...(recon.planId ? { subscriptionPlanId: recon.planId } : {}),
      seatCount: recon.seatCount,
      ...founderStamp,
      currentPeriodEnd: recon.periodEnd ?? new Date(),
      // Trial is over the moment they pay — null it out so the banner
      // hides immediately.
      trialEndsAt: null,
    },
  })

  await syncTrainerAddons(trainerId, recon.activeAddons)
}

async function handleSubscriptionChange(sub: Stripe.Subscription, deleted: boolean, sandbox: boolean) {
  // Prefer the metadata trainerId (set when we created the checkout session)
  // so we don't have to round-trip via stripeCustomerId for new subs.
  let trainerId: string | null = sub.metadata?.trainerId ?? null

  // Fallback: resolve the trainer by Stripe customer when metadata is
  // missing (old subs from before we tagged, or anything created outside
  // our flow). We need a concrete trainerId to reconcile add-on rows.
  if (!trainerId) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const byCustomer = await prisma.trainerProfile.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    })
    trainerId = byCustomer?.id ?? null
  }
  if (!trainerId) {
    console.warn('[stripe webhook] subscription change with no resolvable trainer', { sub: sub.id })
    return
  }

  const recon = await reconcileSubscriptionItems(sub, sandbox)

  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: deleted ? 'CANCELLED' : mapStripeStatus(sub.status),
      ...(recon.planId ? { subscriptionPlanId: recon.planId } : {}),
      ...(deleted ? {} : { seatCount: recon.seatCount }),
      ...(recon.periodEnd ? { currentPeriodEnd: recon.periodEnd } : {}),
    },
  })

  // A cancelled/deleted subscription has no live add-ons.
  await syncTrainerAddons(trainerId, deleted ? [] : recon.activeAddons)
}

interface ReconResult {
  planId: string | null
  seatCount: number
  periodEnd: Date | null
  activeAddons: { itemId: string; subItemId: string }[]
}

// Walk a subscription's line items and classify each by price ID into the
// Core plan, the per-seat charge, and the active add-ons — so we never
// assume items.data[0] is the base. Seat count = seat-line quantity + the
// one trainer included in Core.
async function reconcileSubscriptionItems(sub: Stripe.Subscription, sandbox: boolean): Promise<ReconResult> {
  const index = await loadPriceIndex(sandbox)
  const result: ReconResult = { planId: null, seatCount: 1, periodEnd: null, activeAddons: [] }

  for (const line of sub.items.data) {
    if (!result.periodEnd && line.current_period_end) {
      result.periodEnd = new Date(line.current_period_end * 1000)
    }
    const cls = index.get(line.price.id)
    if (!cls) continue
    if (cls.type === 'core') result.planId = cls.id
    else if (cls.type === 'seat') result.seatCount = (line.quantity ?? 1) + 1
    else if (cls.type === 'addon') result.activeAddons.push({ itemId: cls.id, subItemId: line.id })
  }
  return result
}

// Make the TrainerAddon rows mirror the live subscription: activate the
// add-ons present (recording their Stripe subscription item id for later
// pro-rata toggling), deactivate any that are no longer there.
async function syncTrainerAddons(
  trainerId: string,
  activeAddons: { itemId: string; subItemId: string }[],
) {
  for (const { itemId, subItemId } of activeAddons) {
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId, itemId } },
      create: { trainerId, itemId, stripeSubscriptionItemId: subItemId, active: true },
      update: { stripeSubscriptionItemId: subItemId, active: true },
    })
  }

  const activeIds = activeAddons.map(a => a.itemId)
  await prisma.trainerAddon.updateMany({
    where: { trainerId, active: true, itemId: { notIn: activeIds.length ? activeIds : ['__none__'] } },
    data: { active: false, stripeSubscriptionItemId: null },
  })
}

function mapStripeStatus(status: Stripe.Subscription.Status): 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'INACTIVE' {
  switch (status) {
    case 'active':
    case 'trialing':
      return status === 'trialing' ? 'TRIALING' : 'ACTIVE'
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE'
    case 'canceled':
      return 'CANCELLED'
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'INACTIVE'
    default:
      return 'INACTIVE'
  }
}
