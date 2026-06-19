import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import type { Prisma, SessionType } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'
import { readAccountFlags } from '@/lib/connect'
import { materializeBooking } from '@/lib/booking-page'

// Shape of PaymentItem.intent for a scheduled booking (PACKAGE / SESSION),
// captured at checkout time and replayed here to create the calendar rows.
interface ScheduledIntent {
  slotIso?: string
  dogId?: string | null
  packageId?: string | null
  bookingPageId?: string | null
  singleDurationMins?: number
  singleSessionType?: SessionType
  singleTitle?: string
}

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
        // Only fulfil once the session's payment is actually captured — async
        // payment methods can complete the session while still 'unpaid'.
        if (session.payment_status !== 'paid') break
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
      case 'charge.refunded': {
        await reconcileRefund(event.data.object as Stripe.Charge)
        break
      }
      case 'charge.dispute.created': {
        await markDisputed((event.data.object as Stripe.Dispute).charge)
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
// payment_intent pair) never double-fulfil. Before doing anything it verifies
// the event's real charge matches the stored Payment — amount, currency,
// destination account and Stripe mode — so a forged/mismatched metadata.paymentId
// (e.g. a cheap or test-mode charge pointed at an expensive pending payment)
// can never trigger fulfilment. Also captures the card fee for the invoice.
async function markPaidAndFulfil(paymentId: string | null, eventSandbox: boolean, piId: string | null) {
  if (!paymentId || !piId) return // not one of ours / no charge to verify against

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { items: true },
  })
  if (!payment || payment.status === 'PAID') return // unknown, or already fulfilled

  // Mode must match: a test-mode event must not confirm a live payment.
  if (eventSandbox !== payment.sandbox) {
    console.error('[stripe connect webhook] mode mismatch — refusing to fulfil', paymentId)
    return
  }

  // Retrieve the authoritative charge. A retrieval failure is treated as
  // transient (throw → 500 → Stripe retries) rather than fulfilling blind.
  const pi = await stripeFor(eventSandbox).paymentIntents.retrieve(piId, {
    expand: ['latest_charge.balance_transaction'],
  })
  const charge = pi.latest_charge as Stripe.Charge | null

  // Integrity gate — every check must hold or we ack without fulfilling.
  const destination = typeof charge?.transfer_data?.destination === 'string'
    ? charge.transfer_data.destination
    : charge?.transfer_data?.destination?.id ?? null
  const amountOk = (pi.amount_received ?? 0) >= payment.amountTotal
  const currencyOk = pi.currency === payment.currency
  const destinationOk = destination === payment.connectAccountId
  if (!amountOk || !currencyOk || !destinationOk) {
    console.error('[stripe connect webhook] payment integrity check failed — refusing to fulfil', {
      paymentId, amountOk, currencyOk, destinationOk,
    })
    return
  }

  const stripeChargeId = charge?.id ?? null
  const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null
  const stripeFeeAmount = bt?.fee ?? null

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
      if (!payment.clientId) continue // can't fulfil without a client

      if (item.kind === 'PRODUCT' && item.productId) {
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
      } else if (item.kind === 'PACKAGE' || item.kind === 'SESSION') {
        await fulfilScheduledBooking(tx, {
          itemId: item.id,
          trainerId: payment.trainerId,
          clientId: payment.clientId,
          intent: (item.intent ?? null) as ScheduledIntent | null,
          paidAt: new Date(),
        })
      }
      // CLASS_ENROLLMENT fulfilment lands in a later phase.
    }
  })
}

// Schedule the paid booking (single session or a package's session series)
// using the same materializeBooking path the free booking flows use, then link
// + stamp the resulting ClientPackage. Re-loads the package fresh so cadence/
// duration reflect the current definition.
async function fulfilScheduledBooking(
  tx: Prisma.TransactionClient,
  args: {
    itemId: string
    trainerId: string
    clientId: string
    intent: ScheduledIntent | null
    paidAt: Date
  },
) {
  const intent = args.intent
  if (!intent?.slotIso) {
    console.error('[stripe connect webhook] scheduled item missing slotIso', args.itemId)
    return
  }
  const slotAt = new Date(intent.slotIso)
  if (Number.isNaN(slotAt.getTime())) return

  let pkg: { id: string; name: string; sessionCount: number; weeksBetween: number; durationMins: number; sessionType: SessionType } | null = null
  if (intent.packageId) {
    const p = await tx.package.findUnique({
      where: { id: intent.packageId },
      select: { id: true, name: true, sessionCount: true, weeksBetween: true, durationMins: true, sessionType: true },
    })
    if (p) pkg = p
  }

  // Slot may have been taken between checkout and payment. Re-check the first
  // slot against the trainer's existing sessions (tx-aware). If it collides we
  // do NOT double-book — the Payment stays PAID and is logged for the trainer
  // to rebook or refund. Better a flagged paid-but-unbooked slot than two
  // clients in one slot.
  const clash = await tx.trainingSession.findFirst({
    where: { trainerId: args.trainerId, scheduledAt: slotAt },
    select: { id: true },
  })
  if (clash) {
    console.error('[stripe connect webhook] slot taken before payment cleared — paid but NOT booked', {
      itemId: args.itemId, trainerId: args.trainerId, slotIso: intent.slotIso,
    })
    return
  }

  const clientPackageId = await materializeBooking(tx, {
    trainerId: args.trainerId,
    clientId: args.clientId,
    dogId: intent.dogId ?? null,
    slotAt,
    pkg,
    singleDurationMins: intent.singleDurationMins ?? 60,
    singleSessionType: intent.singleSessionType ?? 'IN_PERSON',
    singleTitle: intent.singleTitle ?? pkg?.name ?? 'Session',
    bookingPageId: intent.bookingPageId ?? null,
  })

  if (clientPackageId) {
    // Link the payment to the assignment and stamp the legacy invoiced flag.
    await tx.paymentItem.update({ where: { id: args.itemId }, data: { clientPackageId } })
    await tx.clientPackage.update({ where: { id: clientPackageId }, data: { invoicedAt: args.paidAt } })
  }
}

// Reconcile a Payment's refunded amount + status from the authoritative charge
// (amount_refunded is the running total Stripe holds, so this is idempotent).
async function reconcileRefund(charge: Stripe.Charge) {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
  const payment = await prisma.payment.findFirst({
    where: { OR: [{ stripeChargeId: charge.id }, ...(piId ? [{ stripePaymentIntentId: piId }] : [])] },
    select: { id: true, amountTotal: true },
  })
  if (!payment) return

  const amountRefunded = charge.amount_refunded ?? 0
  const status = charge.refunded || amountRefunded >= payment.amountTotal
    ? 'REFUNDED'
    : amountRefunded > 0
      ? 'PARTIALLY_REFUNDED'
      : 'PAID'

  await prisma.payment.update({
    where: { id: payment.id },
    data: { amountRefunded, status, stripeChargeId: charge.id },
  })
}

async function markDisputed(chargeRef: string | Stripe.Charge) {
  const chargeId = typeof chargeRef === 'string' ? chargeRef : chargeRef.id
  const payment = await prisma.payment.findFirst({ where: { stripeChargeId: chargeId }, select: { id: true } })
  if (!payment) return
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'DISPUTED' } })
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
