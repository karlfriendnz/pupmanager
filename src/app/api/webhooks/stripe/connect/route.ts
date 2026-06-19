import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'
import { readAccountFlags } from '@/lib/connect'

// Connect webhook — SEPARATE from the subscription webhook (/api/webhooks/stripe).
// Connect events come from a different Stripe endpoint with their own signing
// secret and carry the connected-account id (event.account), so they can't be
// verified by the subscription secret. Keeping this isolated also means a bug
// here can never regress the live Flow A billing webhook.
//
// Handles account.updated (onboarding/enablement) plus payment fulfilment for
// destination charges: checkout.session.completed + payment_intent.succeeded
// mark the Payment paid, capture the card fee, and create what was bought.
// (Configure this one endpoint in Stripe to receive BOTH the platform payment
// events AND connected-account account.updated — same signing secret.)
// charge.refunded / disputes land in a later phase.
export async function POST(req: Request) {
  // Dual-mode, same pattern as the subscription webhook: a live Connect event
  // verifies against STRIPE_CONNECT_WEBHOOK_SECRET, a sandbox (demo) event
  // against the _TEST secret. Whichever verifies tells us the Stripe mode.
  const candidates: { secret: string; sandbox: boolean }[] = []
  if (env.STRIPE_CONNECT_WEBHOOK_SECRET && isStripeConfigured(false)) {
    candidates.push({ secret: env.STRIPE_CONNECT_WEBHOOK_SECRET, sandbox: false })
  }
  if (env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST && isStripeConfigured(true)) {
    candidates.push({ secret: env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST, sandbox: true })
  }
  if (!candidates.length) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

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
    console.error('[stripe connect webhook] signature verification failed for all configured secrets')
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break
      }
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const piId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null
        await markPaidAndFulfil(session.metadata?.paymentId ?? null, sandbox, piId)
        break
      }
      case 'payment_intent.succeeded': {
        // Belt-and-braces — the primary trigger is checkout.session.completed,
        // but this guarantees fulfilment if that event is missed. Idempotent.
        const pi = event.data.object as Stripe.PaymentIntent
        await markPaidAndFulfil(pi.metadata?.paymentId ?? null, sandbox, pi.id)
        break
      }
      default:
        // Silent ack — handled in later phases or genuinely not ours.
        break
    }
  } catch (err) {
    console.error('[stripe connect webhook]', event.type, err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

// Mark a Payment paid and fulfil its items. Idempotent: the PENDING→PAID
// transition is the guard, so duplicate webhooks (and the checkout +
// payment_intent pair) never double-fulfil. Captures Stripe's processing
// ("credit card") fee from the charge's balance transaction for the invoice.
async function markPaidAndFulfil(paymentId: string | null, sandbox: boolean, piId: string | null) {
  if (!paymentId) return // not one of ours (e.g. a subscription session on this endpoint)

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { items: true },
  })
  if (!payment || payment.status === 'PAID') return // unknown, or already fulfilled

  // Pull the charge so we can record the real card fee + charge id.
  let stripeFeeAmount: number | null = null
  let stripeChargeId: string | null = null
  if (piId) {
    try {
      const pi = await stripeFor(sandbox).paymentIntents.retrieve(piId, {
        expand: ['latest_charge.balance_transaction'],
      })
      const charge = pi.latest_charge as Stripe.Charge | null
      stripeChargeId = charge?.id ?? null
      const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null
      stripeFeeAmount = bt?.fee ?? null
    } catch (err) {
      console.warn('[stripe connect webhook] could not load charge for fee', paymentId, err)
    }
  }

  await prisma.$transaction(async (tx) => {
    // Re-check inside the tx so concurrent deliveries can't both fulfil.
    const fresh = await tx.payment.findUnique({ where: { id: paymentId }, select: { status: true } })
    if (!fresh || fresh.status === 'PAID') return

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        stripePaymentIntentId: piId ?? undefined,
        stripeChargeId: stripeChargeId ?? undefined,
        stripeFeeAmount: stripeFeeAmount ?? undefined,
      },
    })

    for (const item of payment.items) {
      if (item.kind === 'PRODUCT' && item.productId && payment.clientId) {
        // A paid product becomes a FULFILLED request the trainer hands over.
        await tx.productRequest.create({
          data: {
            clientId: payment.clientId,
            productId: item.productId,
            status: 'FULFILLED',
            fulfilledAt: new Date(),
            note: 'Paid in PupManager',
          },
        })
      }
      // PACKAGE / SESSION / CLASS_ENROLLMENT fulfilment lands in later phases.
    }
  })
}

async function handleAccountUpdated(account: Stripe.Account) {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { connectAccountId: account.id },
    select: { id: true, connectOnboardedAt: true },
  })
  if (!trainer) {
    // An account we don't recognise (created outside our flow, or a race before
    // we persisted the id) — nothing to mirror.
    return
  }

  const flags = readAccountFlags(account)
  // Stamp the first time the account can both take charges and receive payouts.
  const justOnboarded =
    !trainer.connectOnboardedAt && flags.connectChargesEnabled && flags.connectPayoutsEnabled

  await prisma.trainerProfile.update({
    where: { id: trainer.id },
    data: {
      ...flags,
      ...(justOnboarded ? { connectOnboardedAt: new Date() } : {}),
    },
  })
}
