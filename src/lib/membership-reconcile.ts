import { prisma } from './prisma'
import { stripeFor, isStripeConfigured } from './stripe'
import {
  LIVE_SUBSCRIPTION_STATUSES,
  membershipGrantsAccess,
  restoreMembershipGrants,
  suspendMembershipGrants,
} from './membership-access'
import { mapSubscriptionStatus, periodFromSubscription } from './connect-subscriptions'

// Nightly: does Stripe agree with what we think is happening?
//
// Our row is NEVER the source of truth. The worst failure this feature has is a
// client who cancels, sees "cancelled", and keeps being charged because the
// Stripe call failed and nobody checked — that destroys trust in the TRAINER,
// not in us, and it is a legal problem in several of our markets. The second
// worst is the mirror: a subscription Stripe cancelled that we still show as
// live, so the client thinks they have access they do not.
//
// This job exists to make both of those survivable rather than silent. It reads
// every subscription we believe is live, asks Stripe, and fixes any
// disagreement — including putting the grants back in step, because a status
// that drifted has almost certainly left the grants drifted too.

export interface ReconcileResult {
  checked: number
  corrected: number
  /** Subscriptions Stripe has never heard of, or refused to talk about. */
  unreachable: number
  details: { purchaseId: string; was: string; now: string }[]
}

/**
 * Reconcile one trainer's live subscriptions against Stripe.
 *
 * Scoped per trainer because every call needs that trainer's connected account
 * and Stripe mode — there is no way to ask about them all at once.
 */
export async function reconcileTrainerSubscriptions(trainerId: string): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, corrected: 0, unreachable: 0, details: [] }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { connectAccountId: true, sandboxBilling: true },
  })
  if (!trainer?.connectAccountId) return result
  if (!isStripeConfigured(trainer.sandboxBilling)) return result

  const purchases = await prisma.membershipPurchase.findMany({
    where: {
      trainerId,
      status: { in: LIVE_SUBSCRIPTION_STATUSES },
      stripeSubscriptionId: { not: null },
    },
    select: { id: true, status: true, stripeSubscriptionId: true, cancelAtPeriodEnd: true },
  })

  const stripe = stripeFor(trainer.sandboxBilling)

  for (const p of purchases) {
    if (!p.stripeSubscriptionId) continue
    result.checked++

    let sub
    try {
      sub = await stripe.subscriptions.retrieve(
        p.stripeSubscriptionId,
        undefined,
        { stripeAccount: trainer.connectAccountId },
      )
    } catch (err) {
      // Gone from Stripe entirely, or the account is unreachable. Deliberately
      // NOT treated as "cancelled": a transient Stripe outage must not mass-
      // cancel every subscription on the platform. Counted and logged so a
      // persistent problem is visible.
      result.unreachable++
      console.error('[membership-reconcile] could not read subscription', p.stripeSubscriptionId, err)
      continue
    }

    const truth = mapSubscriptionStatus(sub)
    const { start, end } = periodFromSubscription(sub)
    const drifted = truth !== p.status || (sub.cancel_at_period_end ?? false) !== p.cancelAtPeriodEnd

    if (!drifted) continue

    console.error('[membership-reconcile] DRIFT', {
      purchaseId: p.id, ours: p.status, stripe: truth, subscription: p.stripeSubscriptionId,
    })

    await prisma.$transaction(async (tx) => {
      await tx.membershipPurchase.update({
        where: { id: p.id },
        data: {
          status: truth,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          ...(truth === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      })
      // A status that drifted has almost certainly left the grants drifted too
      // — fixing one without the other is how a half-revoked membership sticks.
      if (membershipGrantsAccess(truth)) {
        await restoreMembershipGrants(tx, p.id)
      } else {
        await suspendMembershipGrants(tx, p.id)
      }
    })

    result.corrected++
    result.details.push({ purchaseId: p.id, was: p.status, now: truth })
  }

  return result
}

/**
 * Every trainer with a live subscription. Runs trainer-by-trainer and never lets
 * one bad account stop the rest — a single trainer whose Stripe account has been
 * closed must not prevent everyone else being reconciled.
 */
export async function reconcileAllSubscriptions(): Promise<ReconcileResult> {
  const total: ReconcileResult = { checked: 0, corrected: 0, unreachable: 0, details: [] }

  const trainers = await prisma.membershipPurchase.findMany({
    where: { status: { in: LIVE_SUBSCRIPTION_STATUSES }, stripeSubscriptionId: { not: null } },
    select: { trainerId: true },
    distinct: ['trainerId'],
  })

  for (const { trainerId } of trainers) {
    try {
      const r = await reconcileTrainerSubscriptions(trainerId)
      total.checked += r.checked
      total.corrected += r.corrected
      total.unreachable += r.unreachable
      total.details.push(...r.details)
    } catch (err) {
      console.error('[membership-reconcile] trainer failed', trainerId, err)
    }
  }

  return total
}
