import type Stripe from 'stripe'
import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { fulfilMembershipInTx, enrolMembershipClasses, regrantRenewalItems } from './memberships'
import {
  addCycles,
  mapSubscriptionStatus,
  paymentIntentIdFromInvoice,
  periodFromSubscription,
  type PlanInterval,
} from './connect-subscriptions'
import { RECURRING_CONSENT_VERSION } from './membership-consent-copy'
import {
  LIVE_SUBSCRIPTION_STATUSES,
  membershipGrantsAccess,
  restoreMembershipGrants,
  suspendMembershipGrants,
} from './membership-access'
import { stripeFor } from './stripe'
import { formatMoney } from './money'
import { notifyClient } from './client-notify'
import { notifyTrainer } from './trainer-notify'
import { sendEmail } from './email'

// The PupManager side of a recurring membership: what a subscription MEANS to a
// client and a trainer, as distinct from what Stripe does about it (that lives
// in connect-subscriptions.ts).
//
// Everything a webhook does lands here, and every function is written to be
// called TWICE with the same input and produce the same result — Stripe sends
// events forever, retries them, and does NOT guarantee order, so
// "invoice.paid arrived before customer.subscription.created" is a case that
// happens rather than a hypothetical.

// The consent WORDING lives in membership-consent-copy.ts — a pure module with
// no prisma/Stripe/notification imports, so the storefront can render the exact
// same sentences this file stores without pulling the billing stack in.
export {
  RECURRING_CONSENT_VERSION,
  buildConsentText,
  describePlanCommitment,
} from './membership-consent-copy'

/**
 * Make sure the MembershipPurchase for a subscription exists before an invoice
 * event tries to write against it.
 *
 * WHY THIS EXISTS. Stripe emits `invoice.paid` for the opening invoice at the
 * same moment as `customer.subscription.created`, and does not order them. When
 * the invoice wins, `recordInvoicePaid` used to find no purchase row and return
 * — on the theory, written into a comment, that "Stripe retries invoice.paid".
 * It does not. We answered 200, so Stripe considers it delivered and never
 * sends it again. Proven against a test clock: the client was charged $100, and
 * nothing was written. No invoice row, no Payment row, no trace.
 *
 * Rather than defer, this goes and GETS the subscription. Retrieving it also
 * lets us expand `default_payment_method`, which webhook payloads never do —
 * so this is also the only place the card snapshot ("your card ending 4242
 * expires before your next payment") ever gets filled in.
 *
 * Returns false only when the subscription genuinely isn't ours — no metadata,
 * or Stripe cannot be reached. The caller then does nothing, which is correct.
 */
async function ensureSubscriptionSynced(args: {
  subscriptionId: string
  sandbox: boolean
  connectAccountId: string | null
}): Promise<boolean> {
  const found = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: args.subscriptionId },
    select: { id: true },
  })
  if (found) return true
  if (!args.connectAccountId) return false

  try {
    const sub = await stripeFor(args.sandbox).subscriptions.retrieve(
      args.subscriptionId,
      { expand: ['default_payment_method'] },
      { stripeAccount: args.connectAccountId },
    )
    await syncSubscription(sub, args.sandbox)
  } catch (err) {
    // Let the webhook fail loudly rather than ack a charge we cannot record.
    // Stripe retries a non-2xx, and by the next attempt the subscription event
    // will almost certainly have landed on its own.
    console.error('[membership-billing] could not back-fill subscription', {
      subscriptionId: args.subscriptionId, err,
    })
    throw err
  }

  const after = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: args.subscriptionId },
    select: { id: true },
  })
  return after != null
}

/**
 * An invoice with its `payments` list populated.
 *
 * `invoice.payment_intent` and `invoice.charge` are gone from the pinned API
 * version; the PaymentIntent now hangs off `invoice.payments`, which is only
 * present when explicitly expanded — and a webhook payload never expands it.
 * So every membership Payment row was being written with a null
 * `stripePaymentIntentId`, and nothing that matches on it (refunds, disputes,
 * the charge.updated fee backfill) could ever find them again.
 */
async function withPayments(
  invoice: Stripe.Invoice,
  sandbox: boolean,
  connectAccountId: string | null,
): Promise<Stripe.Invoice> {
  if (invoice.payments?.data?.length || !invoice.id || !connectAccountId) return invoice
  try {
    return await stripeFor(sandbox).invoices.retrieve(
      invoice.id,
      { expand: ['payments'] },
      { stripeAccount: connectAccountId },
    )
  } catch {
    // Best effort: a missing PaymentIntent id is a reconciliation nuisance, not
    // a reason to drop a payment we otherwise know about.
    return invoice
  }
}

/**
 * The consent row for a subscribe attempt, written BEFORE the Stripe redirect.
 *
 * Reuses a recent unconsumed consent for the same client + plan rather than
 * writing a second one. That reuse is what makes the outbound Stripe
 * idempotency key stable across a double-tap: both taps resolve to the same
 * consent id, so both produce the same key and Stripe collapses them into ONE
 * subscription instead of billing the client twice a month forever.
 */
export async function ensureConsent(args: {
  clientId: string
  membershipId: string
  planId: string
  priceCents: number
  currency: string
  interval: PlanInterval
  consentText: string
  ipAddress: string | null
  userAgent: string | null
}): Promise<{ id: string }> {
  const recent = await prisma.membershipConsent.findFirst({
    where: {
      clientId: args.clientId,
      membershipId: args.membershipId,
      planId: args.planId,
      priceCents: args.priceCents,
      // Only a consent that has NOT already produced a subscription. Once it
      // has, a new subscribe attempt is a genuinely new agreement.
      stripeSubscriptionId: null,
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (recent) return recent

  return prisma.membershipConsent.create({
    data: {
      clientId: args.clientId,
      membershipId: args.membershipId,
      planId: args.planId,
      priceCents: args.priceCents,
      currency: args.currency,
      interval: args.interval,
      consentText: args.consentText,
      consentVersion: RECURRING_CONSENT_VERSION,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    },
    select: { id: true },
  })
}

/**
 * Bring a MembershipPurchase into line with a Stripe Subscription — creating it
 * (and granting everything the membership includes) the first time, syncing
 * status and period dates every time after.
 *
 * This is the single entry point every subscription-shaped webhook funnels
 * through, precisely because events arrive out of order: whichever one lands
 * first creates the row, the rest update it.
 */
export async function syncSubscription(sub: Stripe.Subscription, sandbox: boolean): Promise<void> {
  const meta = sub.metadata ?? {}
  const membershipId = meta.membershipId
  const trainerId = meta.trainerId
  const clientId = meta.clientId
  const planId = meta.planId ?? null
  const consentId = meta.consentId ?? null
  // Without our own metadata we cannot safely attribute this subscription to
  // anyone. Ack and do nothing rather than guess.
  if (!membershipId || !trainerId || !clientId) return

  const { start, end } = periodFromSubscription(sub)
  const status = mapSubscriptionStatus(sub)

  let classGrants: { classRunId: string }[] = []
  let created = false
  let newPurchaseId: string | null = null
  // Refresh the card snapshot whenever Stripe tells us about the subscription,
  // so "your card ending 4242 expires before your next payment" is about the
  // card actually on file rather than one they replaced months ago.
  //
  // A webhook payload NEVER expands default_payment_method, so reading it off
  // the event alone yielded nothing every single time — which quietly made the
  // card-expiry warning unreachable code. When it comes through as a bare id,
  // go and fetch the card.
  const card = await resolveCard(sub, sandbox, trainerId)

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so two concurrent deliveries cannot both
    // take the create branch (the unique index on stripeSubscriptionId is the
    // backstop if they somehow do).
    const existing = await tx.membershipPurchase.findUnique({
      where: { stripeSubscriptionId: sub.id },
      select: { id: true, status: true, accessPausedAt: true },
    })

    if (existing) {
      await tx.membershipPurchase.update({
        where: { id: existing.id },
        data: {
          status,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
          // A successful cycle clears the failure state; syncSubscription is
          // reached with an ACTIVE status only once Stripe is happy again.
          //
          // ALL of it, not just the counter. Clearing failedPaymentCount alone
          // left accessPausedAt and lastPaymentFailedAt set forever on anyone
          // who recovered from a failed payment — the grants below were put
          // back, so the row claimed access was paused while it demonstrably
          // was not, and accessRestoredAt (what the client is told) never got
          // written at all.
          ...(status === 'ACTIVE'
            ? {
                failedPaymentCount: 0,
                lastPaymentFailedAt: null,
                accessPausedAt: null,
                ...(existing.accessPausedAt ? { accessRestoredAt: new Date() } : {}),
              }
            : {}),
          ...card,
        },
      })

      // Keep the grants in step with the status, in BOTH directions. Stripe can
      // move a subscription out of past_due on its own (a retry we never saw an
      // invoice event for), and if only the status moved the client would be
      // left with an active plan and everything still switched off.
      if (membershipGrantsAccess(status)) {
        await restoreMembershipGrants(tx, existing.id)
      } else {
        await suspendMembershipGrants(tx, existing.id)
      }
      return
    }

    created = true
    // Minimum term runs from the subscription's first period start, not from
    // "now" — a late webhook must not push the commitment date out.
    const plan = planId
      ? await tx.membershipPlan.findUnique({
          where: { id: planId },
          select: { minTermCount: true, interval: true },
        })
      : null
    const committedUntil = plan && plan.minTermCount > 0 && start
      ? addCycles(start, plan.interval as PlanInterval, plan.minTermCount)
      : null

    const res = await fulfilMembershipInTx(tx, {
      membershipId,
      trainerId,
      clientId,
      // No Payment row yet — invoice.paid creates one per cycle and links it
      // through MembershipInvoice. A null here is the honest record that this
      // grant was not itself a one-off charge.
      paymentId: null,
      sandbox,
      recurring: {
        planId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
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
    if (newPurchaseId && (card.cardLast4 || card.cardBrand)) {
      await tx.membershipPurchase.update({ where: { id: newPurchaseId }, data: card })
    }

    if (consentId) {
      // Tie the agreement to the thing it authorised. updateMany so a missing or
      // already-consumed consent cannot throw and fail the whole webhook.
      await tx.membershipConsent.updateMany({
        where: { id: consentId, stripeSubscriptionId: null },
        data: { stripeSubscriptionId: sub.id },
      })
    }
  })

  // enrollInRun opens its own transaction, so class places are enrolled after
  // the commit — the same shape the one-off membership path uses. The purchase
  // id goes with them so each seat can be paused (never withdrawn) if the plan
  // stops being paid for.
  if (created && classGrants.length) {
    await enrolMembershipClasses(classGrants, clientId, newPurchaseId)
  }
  if (created) {
    await notifySubscriptionStarted({ membershipId, trainerId, clientId, nextChargeAt: end })
  }
}

/**
 * The card on file, when Stripe happens to have expanded it.
 *
 * `default_payment_method` is an ID string unless the caller asked for it to be
 * expanded, so this yields nothing most of the time and that is fine — the
 * snapshot is a convenience for the client's wording, never something a decision
 * depends on. Returns an empty object rather than nulls so it can be spread into
 * an update without wiping a good snapshot with a blank one.
 */
function cardSnapshotFrom(sub: Stripe.Subscription): {
  cardBrand?: string; cardLast4?: string; cardExpMonth?: number; cardExpYear?: number
} {
  const pm = sub.default_payment_method
  if (!pm || typeof pm === 'string') return {}
  const card = pm.card
  if (!card) return {}
  return {
    cardBrand: card.brand,
    cardLast4: card.last4,
    cardExpMonth: card.exp_month,
    cardExpYear: card.exp_year,
  }
}

/**
 * The card snapshot, fetching the PaymentMethod when the event only carried its
 * id — which is always, for a webhook.
 *
 * One extra Stripe call per subscription event. Subscription events are a
 * handful per client per month, and the alternative is a warning email that
 * can never fire. Failure is swallowed: an empty snapshot is the same
 * best-effort nothing the old code produced, and must never fail a webhook that
 * is also recording money.
 */
async function resolveCard(
  sub: Stripe.Subscription,
  sandbox: boolean,
  trainerId: string,
): Promise<ReturnType<typeof cardSnapshotFrom>> {
  const expanded = cardSnapshotFrom(sub)
  if (expanded.cardLast4 || typeof sub.default_payment_method !== 'string') return expanded

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { connectAccountId: true },
  })
  if (!trainer?.connectAccountId) return {}

  try {
    const pm = await stripeFor(sandbox).paymentMethods.retrieve(
      sub.default_payment_method,
      undefined,
      { stripeAccount: trainer.connectAccountId },
    )
    return cardSnapshotFrom({ ...sub, default_payment_method: pm } as Stripe.Subscription)
  } catch {
    return {}
  }
}

/**
 * A cycle was paid. Records the invoice, mirrors it into a Payment row so the
 * EXISTING refund/dispute/Xero machinery keeps working unchanged, and rolls the
 * period forward.
 *
 * Idempotent on the Stripe invoice id: a re-delivered invoice.paid updates the
 * same row and never creates a second Payment.
 */
export async function recordInvoicePaid(
  invoice: Stripe.Invoice,
  sandbox: boolean,
  subscriptionId: string,
  connectAccountId: string | null = null,
): Promise<void> {
  // Out-of-order delivery: the opening invoice regularly beats
  // customer.subscription.created. Fetch the subscription and build the row now
  // rather than dropping a payment that has already been taken.
  if (!(await ensureSubscriptionSynced({ subscriptionId, sandbox, connectAccountId }))) return

  const purchase = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, trainerId: true, clientId: true, membershipId: true, status: true, accessPausedAt: true },
  })
  if (!purchase) return

  // Was this the retry that rescued a paused membership? Decided before the
  // transaction, because the transaction is what clears the evidence.
  const wasPaused = purchase.status === 'PAST_DUE' || purchase.accessPausedAt != null
  // A renewal, as opposed to the very first invoice of a new subscription.
  // Verified against the pinned API version's BillingReason union.
  const isRenewal = invoice.billing_reason === 'subscription_cycle'
  // Set inside the transaction when this cycle produced a Payment row, so the
  // post-commit Xero reconcile knows what to sync.
  let createdPaymentId: string | null = null

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: purchase.trainerId },
    select: { connectAccountId: true },
  })

  // The PaymentIntent id only exists on an expanded invoice, and this is the
  // row everything downstream matches on.
  const hydrated = await withPayments(invoice, sandbox, connectAccountId ?? trainer?.connectAccountId ?? null)
  const piId = paymentIntentIdFromInvoice(hydrated)
  const currency = (invoice.currency ?? 'nzd').toLowerCase()
  const amountPaid = invoice.amount_paid ?? 0

  await prisma.$transaction(async (tx) => {
    const existing = await tx.membershipInvoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
      select: { id: true, paymentId: true, status: true },
    })

    // ALREADY PAID is the only safe "we finished this one" marker — a plain
    // re-delivery of invoice.paid must not create a second Payment or re-grant
    // a month's consumables. Refresh the mutable numbers and stop.
    if (existing?.status === 'PAID') {
      await tx.membershipInvoice.update({
        where: { id: existing.id },
        data: { amountPaid, attemptCount: invoice.attempt_count ?? 0 },
      })
      return
    }

    // An OPEN row means this invoice FAILED first and has now been paid — the
    // ordinary dunning recovery. It used to take the early return above and
    // stop there, so the money was never mirrored into a Payment row, access
    // stayed flagged as paused, and a renewal's items were never re-granted.
    // Falling through is the fix; the writes below are upserts either way.

    // One Payment per cycle, written as already-PAID from the invoice's own
    // amounts. Deliberately NOT via createPaymentRecord(): that appends the
    // pass-on surcharge line and computes a fixed application_fee_amount,
    // neither of which applies to a subscription invoice.
    let paymentId: string | null = null
    if (amountPaid > 0 && trainer?.connectAccountId) {
      const payment = await tx.payment.create({
        data: {
          trainerId: purchase.trainerId,
          clientId: purchase.clientId,
          connectAccountId: trainer.connectAccountId,
          amountTotal: amountPaid,
          currency,
          // Stripe applied application_fee_percent on its side; the exact cash
          // amount arrives on the charge. charge.updated backfills the real
          // numbers, so recording 0 here would be a lie we then correct — but
          // the column is non-null, so 0 is the only honest placeholder.
          applicationFeeAmount: 0,
          status: 'PAID',
          paidAt: new Date(),
          sandbox,
          stripePaymentIntentId: piId,
          description: 'Membership payment',
        },
        select: { id: true },
      })
      paymentId = payment.id
      createdPaymentId = payment.id
    }

    // Upsert, not create: the row may already be sitting there as OPEN from the
    // failed attempt this payment just rescued.
    await tx.membershipInvoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        membershipPurchaseId: purchase.id,
        stripeInvoiceId: invoice.id,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
        amountDue: invoice.amount_due ?? 0,
        amountPaid,
        currency,
        status: 'PAID',
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        attemptCount: invoice.attempt_count ?? 0,
        paymentId,
        sandbox,
      },
      update: {
        status: 'PAID',
        amountPaid,
        attemptCount: invoice.attempt_count ?? 0,
        actionRequiredAt: null,
        // Never overwrite a payment link that is already there.
        ...(paymentId ? { paymentId } : {}),
      },
    })

    // A paid cycle clears any dunning state. Never DOWNGRADES a CANCELLING row
    // back to ACTIVE — someone who cancelled mid-cycle still has a final
    // invoice, and flipping them to ACTIVE would tell them their cancellation
    // had been undone.
    await tx.membershipPurchase.updateMany({
      where: { id: purchase.id, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: {
        status: 'ACTIVE',
        failedPaymentCount: 0,
        lastPaymentFailedAt: null,
        accessPausedAt: null,
        ...(wasPaused ? { accessRestoredAt: new Date() } : {}),
      },
    })

    // A RENEWAL re-grants the bundle's consumables (a bag of treats every
    // month). Deliberately not on subscription_create — the first cycle's items
    // were already granted when the subscription was set up, and granting them
    // again here would double every new subscriber's opening order.
    if (isRenewal) {
      await regrantRenewalItems(tx, {
        membershipId: purchase.membershipId,
        trainerId: purchase.trainerId,
        clientId: purchase.clientId,
      })
    }

    // Hand everything back. Because access stops on the FIRST failed payment,
    // this restore path is the common one, not the exception — most failures
    // are an expired card replaced within days. Run unconditionally rather than
    // only when we think it was paused: clearing an already-clear flag is free,
    // and a half-restored membership is exactly the bug this must not have.
    await restoreMembershipGrants(tx, purchase.id)
  })

  if (wasPaused) {
    await notifyAccessRestored({
      trainerId: purchase.trainerId,
      clientId: purchase.clientId,
      membershipId: purchase.membershipId,
    })
  }

  // Reconcile the cycle into the trainer's Xero, exactly as a one-off purchase
  // does. It works unchanged because each cycle produces a real Payment row —
  // which is the main reason §6.5 says to create one.
  //
  // Usually a no-op on this pass: the Xero clearing model refuses to post until
  // Stripe's processing fee is known, and the balance transaction is rarely
  // settled this early. charge.updated backfills the fee and re-runs the sync,
  // finding the Payment by the same stripePaymentIntentId recorded above.
  // Best-effort either way — a Xero hiccup must never 500 this webhook and
  // start a Stripe retry loop over a payment that already succeeded.
  if (createdPaymentId) {
    try {
      const { syncPaymentToXero } = await import('./xero-sync')
      await syncPaymentToXero(createdPaymentId)
    } catch (err) {
      console.error('[membership-billing] xero sync failed', createdPaymentId, err)
    }
  }
}

/**
 * A cycle failed. Stripe is now running its own retry schedule.
 *
 * ACCESS STOPS HERE, on the first failure (Karl, 2026-07-27) — not after Stripe
 * exhausts its retries. Everything the membership granted is PAUSED, not
 * deleted: the packages keep their sessions and the class seats stay held, so a
 * successful retry restores it all exactly as it was. With immediate
 * revocation that restore runs often, because most failures are an expired card
 * that gets replaced within days.
 *
 * The client is told immediately, in plain words, what happened and how to fix
 * it. Losing access with no explanation is the worst version of this.
 */
export async function recordInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  sandbox: boolean,
  subscriptionId: string,
  connectAccountId: string | null = null,
): Promise<void> {
  // Same ordering hole as invoice.paid: a first charge can fail before the
  // subscription event lands, and dropping it would leave a client quietly
  // unpaid with access still on.
  if (!(await ensureSubscriptionSynced({ subscriptionId, sandbox, connectAccountId }))) return

  const purchase = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, trainerId: true, clientId: true, membershipId: true },
  })
  if (!purchase) return

  const currency = (invoice.currency ?? 'nzd').toLowerCase()

  await prisma.$transaction(async (tx) => {
    await tx.membershipInvoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        membershipPurchaseId: purchase.id,
        stripeInvoiceId: invoice.id,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
        amountDue: invoice.amount_due ?? 0,
        amountPaid: invoice.amount_paid ?? 0,
        currency,
        status: 'OPEN',
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        attemptCount: invoice.attempt_count ?? 0,
        sandbox,
      },
      update: {
        status: 'OPEN',
        attemptCount: invoice.attempt_count ?? 0,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      },
    })

    // failedPaymentCount tracks STRIPE'S attempt count rather than counting
    // deliveries ourselves, so a replayed webhook cannot inflate it.
    await tx.membershipPurchase.updateMany({
      where: { id: purchase.id, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: {
        status: 'PAST_DUE',
        lastPaymentFailedAt: new Date(),
        failedPaymentCount: Math.max(1, invoice.attempt_count ?? 1),
        accessPausedAt: new Date(),
        accessRestoredAt: null,
      },
    })

    // Pause what the plan granted. Idempotent, so a redelivered
    // invoice.payment_failed pauses nothing twice and loses nothing.
    await suspendMembershipGrants(tx, purchase.id)
  })

  await notifyPaymentFailed({
    trainerId: purchase.trainerId,
    clientId: purchase.clientId,
    membershipId: purchase.membershipId,
    amountCents: invoice.amount_due ?? 0,
    currency,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  })
}

/**
 * The client's bank demanded authentication on a RENEWAL — nobody is at the
 * screen, and nothing in the app can act for them. The payment simply does not
 * happen until they tap through to Stripe's hosted page.
 *
 * This has to reach their phone, not sit as an in-app badge they might see next
 * week. Far more likely for UK/EU trainers than NZ/AU ones — an NZ-only pilot
 * will barely see it, which is exactly why it must not be skipped before a UK
 * trainer goes live.
 */
export async function recordInvoiceActionRequired(
  invoice: Stripe.Invoice,
  sandbox: boolean,
  subscriptionId: string,
  connectAccountId: string | null = null,
): Promise<void> {
  if (!(await ensureSubscriptionSynced({ subscriptionId, sandbox, connectAccountId }))) return

  const purchase = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, trainerId: true, clientId: true, membershipId: true },
  })
  if (!purchase) return

  const currency = (invoice.currency ?? 'nzd').toLowerCase()
  const hostedInvoiceUrl = invoice.hosted_invoice_url ?? null

  await prisma.membershipInvoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      membershipPurchaseId: purchase.id,
      stripeInvoiceId: invoice.id,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      currency,
      status: 'OPEN',
      hostedInvoiceUrl,
      actionRequiredAt: new Date(),
      attemptCount: invoice.attempt_count ?? 0,
      sandbox,
    },
    update: { status: 'OPEN', hostedInvoiceUrl, actionRequiredAt: new Date() },
  })

  const [membership, trainer, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: purchase.membershipId }, select: { name: true } }),
    prisma.trainerProfile.findUnique({ where: { id: purchase.trainerId }, select: { businessName: true } }),
    prisma.clientProfile.findUnique({ where: { id: purchase.clientId }, select: { user: { select: { id: true } } } }),
  ])

  if (client?.user?.id) {
    await notifyClient({
      userId: client.user.id,
      trainerId: purchase.trainerId,
      type: 'CLIENT_PAYMENT_REQUEST',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        amount: formatMoney(invoice.amount_due ?? 0, currency),
        description: `${membership?.name ?? 'your plan'} — your bank needs you to approve this payment`,
      },
      link: '/my-memberships',
      ctaLabel: 'Approve your payment',
    }).catch(err => console.error('[membership-billing] action-required notify failed', err))
  }
}

/**
 * A renewal is coming up (Stripe fires this ~3 days ahead, if the event is
 * subscribed). Two jobs: a heads-up, and a check that the card on file will
 * still be alive when the charge lands.
 *
 * A card that expires BEFORE the renewal is the most preventable failure there
 * is — and with access stopping on the first failure, preventing it is worth
 * considerably more than it used to be.
 */
export async function recordInvoiceUpcoming(
  invoice: Stripe.Invoice,
  subscriptionId: string,
): Promise<void> {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: {
      id: true, trainerId: true, clientId: true, membershipId: true, status: true,
      cardBrand: true, cardLast4: true, cardExpMonth: true, cardExpYear: true,
    },
  })
  if (!purchase) return
  // Don't chase someone who has already cancelled or been cut off.
  if (purchase.status !== 'ACTIVE') return

  const currency = (invoice.currency ?? 'nzd').toLowerCase()
  const dueAt = invoice.period_end ? new Date(invoice.period_end * 1000) : null

  const [membership, trainer, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: purchase.membershipId }, select: { name: true } }),
    prisma.trainerProfile.findUnique({ where: { id: purchase.trainerId }, select: { businessName: true } }),
    prisma.clientProfile.findUnique({ where: { id: purchase.clientId }, select: { user: { select: { id: true } } } }),
  ])
  if (!client?.user?.id) return

  const expiring = cardExpiresBefore(purchase, dueAt ?? new Date())
  const planName = membership?.name ?? 'your plan'
  const amount = formatMoney(invoice.amount_due ?? 0, currency)

  await notifyClient({
    userId: client.user.id,
    trainerId: purchase.trainerId,
    type: 'CLIENT_PAYMENT_REQUEST',
    vars: {
      trainerName: trainer?.businessName ?? 'Your trainer',
      amount,
      description: expiring
        ? `${planName} — your card ending ${purchase.cardLast4 ?? '••••'} expires before this payment. Update it so your plan keeps running.`
        : `${planName} — your next payment is coming up`,
    },
    link: '/my-memberships',
    ctaLabel: expiring ? 'Update your card' : 'View your plan',
  }).catch(err => console.error('[membership-billing] upcoming notify failed', err))
}

/**
 * Will the card on file be dead by the time this charge lands? Cards expire at
 * the END of their stated month.
 */
export function cardExpiresBefore(
  card: { cardExpMonth: number | null; cardExpYear: number | null },
  when: Date,
): boolean {
  if (!card.cardExpMonth || !card.cardExpYear) return false
  // First instant of the month AFTER the card's expiry month.
  const deadFrom = new Date(Date.UTC(card.cardExpYear, card.cardExpMonth, 1))
  return when.getTime() >= deadFrom.getTime()
}

/**
 * A client finished the update-card flow. Point the subscription at the new card
 * and — the whole reason they came — try the outstanding invoice again right
 * now, rather than making them wait days for Stripe's next scheduled retry
 * while their plan sits paused.
 *
 * Every step is guarded independently: a failure to pay the open invoice must
 * not lose the new card, because the card is the part that fixes all the FUTURE
 * cycles even if this one has to wait for Stripe.
 */
export async function completeCardUpdateForSubscription(args: {
  purchaseId: string
  paymentMethodId: string
  connectAccountId: string
  sandbox: boolean
}): Promise<void> {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { id: args.purchaseId },
    select: { id: true, stripeSubscriptionId: true, stripeCustomerId: true },
  })
  if (!purchase?.stripeSubscriptionId) return

  const stripe = stripeFor(args.sandbox)
  const opts = { stripeAccount: args.connectAccountId }

  // Make it the subscription's default so every future cycle uses it, and the
  // customer's default so anything else raised on the account does too.
  const sub = await stripe.subscriptions.update(
    purchase.stripeSubscriptionId,
    { default_payment_method: args.paymentMethodId },
    opts,
  )
  if (purchase.stripeCustomerId) {
    await stripe.customers
      .update(purchase.stripeCustomerId, { invoice_settings: { default_payment_method: args.paymentMethodId } }, opts)
      .catch(err => console.error('[membership-billing] customer default pm failed', err))
  }

  // Record which card they are now on, so the expiry warning is about this one.
  const card = cardSnapshotFrom(sub)
  if (card.cardLast4 || card.cardBrand) {
    await prisma.membershipPurchase.update({ where: { id: purchase.id }, data: card })
  }

  // Retry the outstanding cycle immediately. If it succeeds, invoice.paid comes
  // straight back and restores their access — which is the point of the whole
  // journey they just went through.
  const open = await prisma.membershipInvoice.findFirst({
    where: { membershipPurchaseId: purchase.id, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    select: { stripeInvoiceId: true },
  })
  if (open?.stripeInvoiceId) {
    try {
      await stripe.invoices.pay(open.stripeInvoiceId, { payment_method: args.paymentMethodId }, opts)
    } catch (err) {
      // The new card was declined too, or the invoice is no longer payable.
      // Stripe's own retry schedule still stands, and the card is saved.
      console.error('[membership-billing] immediate retry after card update failed', open.stripeInvoiceId, err)
    }
  }
}

/**
 * The trainer disconnected their Stripe account (or Stripe disconnected it for
 * them). We can no longer bill anyone on their behalf.
 *
 * Karl's call (2026-07-27): we CANCEL every live subscription and tell every
 * affected client. It is the only option that doesn't leave people being charged
 * by a business PupManager no longer has any relationship with — and the only
 * one a client would expect.
 *
 * Best-effort on Stripe's side: the account may already be gone, in which case
 * the subscriptions went with it. Our rows are marked ORPHANED regardless, so we
 * never keep showing a client a plan nobody is running.
 */
export async function handleAccountDeauthorized(connectAccountId: string, sandbox: boolean): Promise<void> {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { connectAccountId },
    select: { id: true, businessName: true, user: { select: { id: true, email: true } } },
  })
  if (!trainer) return

  const live = await prisma.membershipPurchase.findMany({
    where: { trainerId: trainer.id, status: { in: LIVE_SUBSCRIPTION_STATUSES }, stripeSubscriptionId: { not: null } },
    select: { id: true, clientId: true, membershipId: true, stripeSubscriptionId: true },
  })

  await prisma.trainerProfile.update({
    where: { id: trainer.id },
    data: {
      connectDeauthorizedAt: new Date(),
      // Nothing can be charged any more; don't leave buy buttons on offer.
      connectChargesEnabled: false,
      acceptPaymentsEnabled: false,
      recurringPaymentsEnabled: false,
    },
  })

  for (const p of live) {
    // Try to stop it at Stripe too. Usually already gone with the account —
    // that is not an error, so failure here must not stop us marking our row.
    if (p.stripeSubscriptionId) {
      try {
        await stripeFor(sandbox).subscriptions.cancel(p.stripeSubscriptionId, undefined, { stripeAccount: connectAccountId })
      } catch {
        // Account or subscription already gone. Nothing left to cancel.
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.membershipPurchase.update({
        where: { id: p.id },
        data: { status: 'ORPHANED', cancelledAt: new Date(), cancelReason: 'TRAINER_DISCONNECTED', accessPausedAt: new Date() },
      })
      await suspendMembershipGrants(tx, p.id)
    })

    await notifyPlanOrphaned({
      trainerId: trainer.id,
      trainerName: trainer.businessName ?? 'Your trainer',
      clientId: p.clientId,
      membershipId: p.membershipId,
    }).catch(err => console.error('[membership-billing] orphan notify failed', p.id, err))
  }

  if (live.length && trainer.user?.email) {
    await sendEmail({
      to: trainer.user.email,
      subject: `Your ${live.length} ongoing client plan${live.length === 1 ? '' : 's'} have been stopped`,
      html: `<p>Your Stripe account is no longer connected to PupManager, so we can't take payments for you any more.</p><p>We've stopped ${live.length} ongoing client plan${live.length === 1 ? '' : 's'} and let those clients know they won't be charged again. Reconnect Stripe in <strong>Settings → Payments</strong> if this wasn't intended — you'll need to ask those clients to sign up again.</p>`,
      text: `Your Stripe account is no longer connected to PupManager. We've stopped ${live.length} ongoing client plan(s) and told those clients. Reconnect in Settings → Payments if this wasn't intended.`,
      // Their income just stopped — this reaches them whatever else is muted.
      alwaysSend: true,
    }).catch(err => console.error('[membership-billing] deauth trainer email failed', err))
  }
}

// ─── Notifications ──────────────────────────────────────────────────────────
// Reuses the existing CLIENT_ADDED_TO_PLAN / CLIENT_SHOP_ORDER types rather than
// adding NotificationType enum values. CLIENT_SHOP_ORDER is already documented
// as "a client bought or requested one of your shop products" and carries a
// free-form `detail`, so it already means "someone spent money with you" — the
// same reasoning the membership-request route records for reusing it.

async function notifySubscriptionStarted(args: {
  membershipId: string
  trainerId: string
  clientId: string
  nextChargeAt: Date | null
}): Promise<void> {
  const [membership, trainer, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: args.membershipId }, select: { name: true } }),
    prisma.trainerProfile.findUnique({
      where: { id: args.trainerId },
      select: { businessName: true, user: { select: { id: true } } },
    }),
    prisma.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { user: { select: { id: true, name: true } }, dog: { select: { name: true } } },
    }),
  ])
  const planName = membership?.name ?? 'your plan'

  if (client?.user?.id) {
    await notifyClient({
      userId: client.user.id,
      trainerId: args.trainerId,
      type: 'CLIENT_ADDED_TO_PLAN',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        dogName: client.dog?.name ?? '',
        planName,
        detail: args.nextChargeAt ? `Next payment ${args.nextChargeAt.toLocaleDateString('en-NZ')}` : '',
      },
      link: '/my-memberships',
      ctaLabel: 'View your plan',
    }).catch(err => console.error('[membership-billing] client start notify failed', err))
  }

  if (trainer?.user?.id) {
    await notifyTrainer(
      trainer.user.id,
      'CLIENT_SHOP_ORDER',
      {
        clientName: client?.user?.name ?? 'A client',
        dogName: client?.dog?.name ?? '',
        detail: `started the ongoing plan “${planName}”`,
      },
      `/clients/${args.clientId}`,
      args.trainerId,
    ).catch(err => console.error('[membership-billing] trainer start notify failed', err))
  }
}

async function notifyPaymentFailed(args: {
  trainerId: string
  clientId: string
  membershipId: string
  amountCents: number
  currency: string
  hostedInvoiceUrl?: string | null
}): Promise<void> {
  const [membership, trainer, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: args.membershipId }, select: { name: true } }),
    prisma.trainerProfile.findUnique({
      where: { id: args.trainerId },
      select: { businessName: true, user: { select: { id: true } } },
    }),
    prisma.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { user: { select: { id: true, name: true } } },
    }),
  ])
  const planName = membership?.name ?? 'your plan'
  const amount = formatMoney(args.amountCents, args.currency)

  // Access has just stopped, so this is not a nicety — it is the ONLY thing
  // standing between the client and losing their sessions with no explanation.
  // Says three things in order: it didn't go through, your plan is paused, here
  // is how to turn it back on. Never shaming: most of these are an expired card.
  if (client?.user?.id) {
    await notifyClient({
      userId: client.user.id,
      trainerId: args.trainerId,
      type: 'CLIENT_PAYMENT_REQUEST',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        amount,
        description: `${planName} — your payment didn’t go through, so your plan is paused. Update your card to turn it back on.`,
      },
      link: '/my-memberships',
      ctaLabel: 'Update your card',
    }).catch(err => console.error('[membership-billing] client fail notify failed', err))
  }

  if (trainer?.user?.id) {
    await notifyTrainer(
      trainer.user.id,
      'CLIENT_SHOP_ORDER',
      {
        clientName: client?.user?.name ?? 'A client',
        dogName: '',
        detail: `had a payment of ${amount} fail for “${planName}” — their plan is paused until it clears`,
      },
      `/clients/${args.clientId}`,
      args.trainerId,
    ).catch(err => console.error('[membership-billing] trainer fail notify failed', err))
  }
}

/**
 * A retry went through and they have everything back. Worth saying out loud:
 * they were told their plan was paused, so they must be told it isn't any more
 * — otherwise they assume it's still broken and email the trainer about it.
 */
async function notifyAccessRestored(args: {
  trainerId: string
  clientId: string
  membershipId: string
}): Promise<void> {
  const [membership, trainer, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: args.membershipId }, select: { name: true } }),
    prisma.trainerProfile.findUnique({
      where: { id: args.trainerId },
      select: { businessName: true, user: { select: { id: true } } },
    }),
    prisma.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { user: { select: { id: true, name: true } }, dog: { select: { name: true } } },
    }),
  ])
  const planName = membership?.name ?? 'your plan'

  if (client?.user?.id) {
    await notifyClient({
      userId: client.user.id,
      trainerId: args.trainerId,
      type: 'CLIENT_ADDED_TO_PLAN',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        dogName: client.dog?.name ?? '',
        planName,
        detail: 'Your payment went through — everything is back on',
      },
      link: '/my-memberships',
      ctaLabel: 'View your plan',
    }).catch(err => console.error('[membership-billing] restore notify failed', err))
  }

  if (trainer?.user?.id) {
    await notifyTrainer(
      trainer.user.id,
      'CLIENT_SHOP_ORDER',
      {
        clientName: client?.user?.name ?? 'A client',
        dogName: client?.dog?.name ?? '',
        detail: `paid for “${planName}” — their plan is running again`,
      },
      `/clients/${args.clientId}`,
      args.trainerId,
    ).catch(err => console.error('[membership-billing] trainer restore notify failed', err))
  }
}

/**
 * Their trainer disconnected Stripe, so the plan has ended through no fault or
 * choice of theirs. Say that plainly, and say the thing they most want to know:
 * they will not be charged again.
 */
async function notifyPlanOrphaned(args: {
  trainerId: string
  trainerName: string
  clientId: string
  membershipId: string
}): Promise<void> {
  const [membership, client] = await Promise.all([
    prisma.membership.findUnique({ where: { id: args.membershipId }, select: { name: true } }),
    prisma.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { user: { select: { id: true } }, dog: { select: { name: true } } },
    }),
  ])
  if (!client?.user?.id) return

  await notifyClient({
    userId: client.user.id,
    trainerId: args.trainerId,
    type: 'CLIENT_ADDED_TO_PLAN',
    vars: {
      trainerName: args.trainerName,
      dogName: client.dog?.name ?? '',
      planName: membership?.name ?? 'your plan',
      detail: `${args.trainerName} has stopped taking payments through PupManager, so this plan has ended. You won’t be charged again.`,
    },
    link: '/my-memberships',
    ctaLabel: 'View your plans',
  })
}

/**
 * Has this client already got a live subscription to this membership? Used by
 * the buy route so a second Subscribe cannot stack a second monthly charge on
 * the same plan.
 */
export async function findLiveSubscription(
  clientId: string,
  membershipId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.membershipPurchase.findFirst({
    where: {
      clientId,
      membershipId,
      // CANCELLING counts as live: they are still inside a period they paid for,
      // and re-subscribing on top would double-bill them for the overlap.
      status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING'] },
      stripeSubscriptionId: { not: null },
    },
    select: { id: true, status: true, stripeSubscriptionId: true },
  })
}
