import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'

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
  if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Stripe's signature verification needs the raw body bytes, so we read
  // the request as text — the Next.js App Router gives us the unparsed
  // body via .text() before any JSON middleware touches it.
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[stripe webhook] signature verification failed:', msg)
    return NextResponse.json({ error: `Webhook signature: ${msg}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(session)
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(sub, event.type === 'customer.subscription.deleted')
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const trainerId = session.metadata?.trainerId
  const planId = session.metadata?.planId
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

  if (!trainerId || !subscriptionId) {
    console.warn('[stripe webhook] checkout.session.completed missing trainerId or subscription', { trainerId, subscriptionId })
    return
  }

  // Pull the actual subscription so we can write the canonical period end
  // and status — the checkout session itself doesn't expose those reliably.
  const sub = await stripe().subscriptions.retrieve(subscriptionId)

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
      ...(planId ? { subscriptionPlanId: planId } : {}),
      ...founderStamp,
      currentPeriodEnd: new Date(sub.items.data[0]?.current_period_end ? sub.items.data[0].current_period_end * 1000 : Date.now()),
      // Trial is over the moment they pay — null it out so the banner
      // hides immediately.
      trialEndsAt: null,
    },
  })
}

async function handleSubscriptionChange(sub: Stripe.Subscription, deleted: boolean) {
  // Prefer the metadata trainerId (set when we created the checkout session)
  // so we don't have to round-trip via stripeCustomerId for new subs.
  const trainerId = sub.metadata?.trainerId ?? null

  const periodEnd = sub.items.data[0]?.current_period_end
    ? new Date(sub.items.data[0].current_period_end * 1000)
    : null

  // Map a Stripe price to one of our plans so we can keep
  // subscriptionPlanId in sync if the trainer upgrades/downgrades.
  const priceId = sub.items.data[0]?.price.id
  const plan = priceId
    ? await prisma.subscriptionPlan.findUnique({ where: { stripePriceId: priceId }, select: { id: true } })
    : null

  const data = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: deleted ? ('CANCELLED' as const) : mapStripeStatus(sub.status),
    ...(plan ? { subscriptionPlanId: plan.id } : {}),
    ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
  }

  if (trainerId) {
    await prisma.trainerProfile.update({ where: { id: trainerId }, data })
    return
  }

  // Fallback: look up by customer if metadata is missing (old subs from
  // before we started tagging, or anything created outside our flow).
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  await prisma.trainerProfile.updateMany({
    where: { stripeCustomerId: customerId },
    data,
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
