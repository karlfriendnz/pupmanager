// Fulfilment for combo memberships. When a membership checkout is paid, the
// connect webhook calls fulfilMembershipInTx inside the payment transaction to
// grant every included PACKAGE (assigned as a ClientPackage, with its sessions)
// and PRODUCT (a fulfilled order), and to record the MembershipPurchase. CLASS
// items are returned to enrol AFTER the tx commits — enrollInRun opens its own
// transaction and can't be nested.
import type { Prisma } from '@/generated/prisma'
import { takeStock } from './stock'
import { materializeBooking } from './booking-page'
import { enrollInRun } from './class-runs'

type Tx = Prisma.TransactionClient

export interface MembershipClassGrant { classRunId: string }

/**
 * The recurring shape, supplied when the grant comes from a Stripe Subscription
 * rather than a one-off checkout. Stripe is the source of truth for every date
 * in here — none of it is computed locally, and the billing date is simply the
 * anniversary of the day they subscribed.
 */
export interface MembershipRecurringInput {
  planId: string | null
  stripeSubscriptionId: string
  stripeCustomerId: string | null
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLING' | 'CANCELLED' | 'PAUSED'
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  committedUntil: Date | null
  cancelAtPeriodEnd: boolean
  applicationFeePercent: number | null
}

export async function fulfilMembershipInTx(
  tx: Tx,
  args: {
    membershipId: string; trainerId: string; clientId: string
    /**
     * The settled Payment, or null when the trainer granted the package
     * themselves — accepting a client's "Request this" for a recurring plan or
     * an unpriced package, neither of which checkout can take. The purchase is
     * recorded either way; a null paymentId is the record that no money moved.
     */
    paymentId: string | null
    sandbox: boolean
    /**
     * Present for a RECURRING membership bought via a Stripe Subscription. Its
     * absence is what makes a purchase one-off, so existing callers are
     * unaffected.
     */
    recurring?: MembershipRecurringInput
  },
): Promise<{ classGrants: MembershipClassGrant[] }> {
  const membership = await tx.membership.findUnique({
    where: { id: args.membershipId },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  // Only fulfil the trainer's own membership (defence in depth — the payment is
  // already scoped to this trainer's connected account).
  if (!membership || membership.trainerId !== args.trainerId) return { classGrants: [] }

  const classGrants: MembershipClassGrant[] = []
  const now = new Date()

  for (const item of membership.items) {
    const qty = Math.max(1, item.quantity)

    if (item.kind === 'PACKAGE' && item.packageId) {
      const pkg = await tx.package.findFirst({
        where: { id: item.packageId, trainerId: args.trainerId },
        select: { id: true, name: true, sessionCount: true, weeksBetween: true, durationMins: true, bufferMins: true, sessionType: true },
      })
      if (!pkg) continue
      // One ClientPackage assignment per quantity — the same grant buying the
      // package normally produces, scheduled from today (reschedulable).
      for (let i = 0; i < qty; i++) {
        await materializeBooking(tx, {
          trainerId: args.trainerId, clientId: args.clientId, dogId: null, pkg, slotAt: now,
          // Unused when pkg is set, but required by the shared shape.
          singleDurationMins: pkg.durationMins, singleSessionType: pkg.sessionType, singleTitle: pkg.name, bookingPageId: null,
        })
      }
    } else if (item.kind === 'PRODUCT' && item.productId) {
      const prod = await tx.product.findFirst({ where: { id: item.productId, trainerId: args.trainerId }, select: { id: true } })
      if (!prod) continue
      for (let i = 0; i < qty; i++) {
        // Take stock per unit. A membership that's already been paid for is
        // still granted if the shelf is empty — the trainer owes them the item
        // either way — but the count never goes negative.
        await takeStock(tx, item.productId)
        await tx.productRequest.create({
          data: { clientId: args.clientId, productId: item.productId, status: 'FULFILLED', fulfilledAt: now, note: `Package: ${membership.name}` },
        })
      }
    } else if (item.kind === 'CLASS' && item.classRunId) {
      // One place per class item, enrolled post-commit.
      classGrants.push({ classRunId: item.classRunId })
    }
  }

  // Record the purchase. A ONE_OFF has no term or period and is ACTIVE from the
  // moment it is paid. A RECURRING one carries the Stripe subscription and the
  // period/term dates Stripe reported — all of them read back from Stripe, never
  // computed here, so our row can never claim a billing date Stripe disagrees
  // with.
  const r = args.recurring
  await tx.membershipPurchase.create({
    data: {
      membershipId: membership.id,
      trainerId: args.trainerId,
      clientId: args.clientId,
      paymentId: args.paymentId,
      sandbox: args.sandbox,
      status: r ? r.status : 'ACTIVE',
      ...(r
        ? {
            planId: r.planId,
            stripeSubscriptionId: r.stripeSubscriptionId,
            stripeCustomerId: r.stripeCustomerId,
            currentPeriodStart: r.currentPeriodStart,
            currentPeriodEnd: r.currentPeriodEnd,
            committedUntil: r.committedUntil,
            cancelAtPeriodEnd: r.cancelAtPeriodEnd,
            applicationFeePercent: r.applicationFeePercent,
          }
        : {}),
    },
  })

  return { classGrants }
}

/**
 * Post-commit: enrol the buyer into each included class. Best-effort — a full /
 * closed class logs and moves on rather than failing the whole fulfilment.
 * (Phase 1 auto-enrols; approval-gated classes are a fast-follow.)
 */
export async function enrolMembershipClasses(grants: MembershipClassGrant[], clientId: string): Promise<void> {
  for (const g of grants) {
    try {
      await enrollInRun({ classRunId: g.classRunId, clientId, dogId: null, type: 'FULL', source: 'SELF_SERVE' })
    } catch (err) {
      console.error('[membership] class enrol failed', g.classRunId, err instanceof Error ? err.message : err)
    }
  }
}
