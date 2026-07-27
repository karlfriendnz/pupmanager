import type Stripe from 'stripe'
import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { fulfilMembershipInTx, enrolMembershipClasses } from './memberships'
import {
  addCycles,
  mapSubscriptionStatus,
  paymentIntentIdFromInvoice,
  periodFromSubscription,
  type PlanInterval,
} from './connect-subscriptions'
import { RECURRING_CONSENT_VERSION } from './membership-consent-copy'
import { formatMoney } from './money'
import { notifyClient } from './client-notify'
import { notifyTrainer } from './trainer-notify'

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

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so two concurrent deliveries cannot both
    // take the create branch (the unique index on stripeSubscriptionId is the
    // backstop if they somehow do).
    const existing = await tx.membershipPurchase.findUnique({
      where: { stripeSubscriptionId: sub.id },
      select: { id: true, status: true },
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
          ...(status === 'ACTIVE' ? { failedPaymentCount: 0 } : {}),
        },
      })
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
  // the commit — the same shape the one-off membership path uses.
  if (created && classGrants.length) {
    await enrolMembershipClasses(classGrants, clientId)
  }
  if (created) {
    await notifySubscriptionStarted({ membershipId, trainerId, clientId, nextChargeAt: end })
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
): Promise<void> {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, trainerId: true, clientId: true, membershipId: true },
  })
  // Out-of-order delivery: the subscription event has not landed yet. Ack and
  // do nothing — Stripe retries invoice.paid, and by then syncSubscription will
  // have created the row. Deliberately NOT creating a half-formed purchase here.
  if (!purchase) return

  const piId = paymentIntentIdFromInvoice(invoice)
  const currency = (invoice.currency ?? 'nzd').toLowerCase()
  const amountPaid = invoice.amount_paid ?? 0

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: purchase.trainerId },
    select: { connectAccountId: true },
  })

  await prisma.$transaction(async (tx) => {
    const existing = await tx.membershipInvoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
      select: { id: true, paymentId: true },
    })
    if (existing) {
      await tx.membershipInvoice.update({
        where: { id: existing.id },
        data: { status: 'PAID', amountPaid, attemptCount: invoice.attempt_count ?? 0 },
      })
      return
    }

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
    }

    await tx.membershipInvoice.create({
      data: {
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
    })

    // A paid cycle clears any dunning state. Never DOWNGRADES a CANCELLING row
    // back to ACTIVE — someone who cancelled mid-cycle still has a final
    // invoice, and flipping them to ACTIVE would tell them their cancellation
    // had been undone.
    await tx.membershipPurchase.updateMany({
      where: { id: purchase.id, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: { status: 'ACTIVE', failedPaymentCount: 0, lastPaymentFailedAt: null },
    })
  })
}

/**
 * A cycle failed. Stripe is now running its own retry schedule.
 *
 * Access CONTINUES — we record the state and tell both sides, and nothing here
 * revokes anything. Cutting a client off from their dog's classes because a card
 * bounced on a Tuesday is the wrong call when they will usually pay within days;
 * only Stripe giving up entirely ends the subscription, and that arrives as a
 * subscription event, not this one.
 */
export async function recordInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  sandbox: boolean,
  subscriptionId: string,
): Promise<void> {
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
      },
    })
  })

  await notifyPaymentFailed({
    trainerId: purchase.trainerId,
    clientId: purchase.clientId,
    membershipId: purchase.membershipId,
    amountCents: invoice.amount_due ?? 0,
    currency,
  })
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

  // Never a silent failure, and never shaming — they will usually fix it in a
  // day. The full "we'll try again on the 18th, update your card here" surface
  // is Phase 2; Phase 1 makes sure they are told at all.
  if (client?.user?.id) {
    await notifyClient({
      userId: client.user.id,
      trainerId: args.trainerId,
      type: 'CLIENT_PAYMENT_REQUEST',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        amount,
        description: `${planName} — your payment didn't go through`,
      },
      link: '/my-memberships',
      ctaLabel: 'Check your payment',
    }).catch(err => console.error('[membership-billing] client fail notify failed', err))
  }

  if (trainer?.user?.id) {
    await notifyTrainer(
      trainer.user.id,
      'CLIENT_SHOP_ORDER',
      {
        clientName: client?.user?.name ?? 'A client',
        dogName: '',
        detail: `had a payment of ${amount} fail for “${planName}” — Stripe is retrying`,
      },
      `/clients/${args.clientId}`,
      args.trainerId,
    ).catch(err => console.error('[membership-billing] trainer fail notify failed', err))
  }
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
