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
// Phase 1 handles account.updated (onboarding/enablement). Payment fulfilment
// events (checkout.session.completed, charge.refunded, …) arrive here too and
// will be handled in later phases.
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
  for (const c of candidates) {
    try {
      event = stripeFor(c.sandbox).webhooks.constructEvent(raw, sig, c.secret)
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
