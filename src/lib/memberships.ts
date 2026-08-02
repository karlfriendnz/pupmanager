// Fulfilment for combo memberships. When a membership checkout is paid, the
// connect webhook calls fulfilMembershipInTx inside the payment transaction to
// grant every included PACKAGE (assigned as a ClientPackage, with its sessions)
// and PRODUCT (a fulfilled order), and to record the MembershipPurchase. CLASS
// items are returned to enrol AFTER the tx commits — enrollInRun opens its own
// transaction and can't be nested.
import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
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
): Promise<{ classGrants: MembershipClassGrant[]; membershipPurchaseId: string | null }> {
  const membership = await tx.membership.findUnique({
    where: { id: args.membershipId },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  // Only fulfil the trainer's own membership (defence in depth — the payment is
  // already scoped to this trainer's connected account).
  if (!membership || membership.trainerId !== args.trainerId) return { classGrants: [], membershipPurchaseId: null }

  const classGrants: MembershipClassGrant[] = []
  const now = new Date()

  // Record the purchase FIRST, so every grant below can be stamped with its id.
  // That link is what makes a membership's benefits pausable: when a payment
  // fails we have to be able to find exactly what this plan gave them, pause it,
  // and hand it all back intact when a Stripe retry succeeds.
  //
  // A ONE_OFF has no term or period and is ACTIVE from the moment it is paid. A
  // RECURRING one carries the Stripe subscription and the period/term dates
  // Stripe reported — all read back from Stripe, never computed here, so our row
  // can never claim a billing date Stripe disagrees with.
  const r = args.recurring
  const purchase = await tx.membershipPurchase.create({
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
    select: { id: true },
  })
  // Only a RECURRING purchase can lapse for non-payment, so only its grants need
  // to be findable. A one-off is paid for once and never taken away.
  const grantOwnerId = r ? purchase.id : null

  // An invitation that has been taken up. Marked here rather than in the buy
  // route because this is the ONE place a membership is ever granted — by
  // checkout, by an upgrade, or by a trainer accepting a request — so an
  // invitation cannot end up still reading "waiting" after the client joined.
  // updateMany, so a package with no invitation is a silent no-op.
  await tx.membershipRequest.updateMany({
    where: {
      clientId: args.clientId,
      membershipId: membership.id,
      reason: 'INVITE',
      status: 'PENDING',
    },
    data: { status: 'FULFILLED', fulfilledAt: now },
  })

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
        const { clientPackageId } = await materializeBooking(tx, {
          trainerId: args.trainerId, clientId: args.clientId, dogId: null, pkg, slotAt: now,
          // Unused when pkg is set, but required by the shared shape.
          singleDurationMins: pkg.durationMins, singleSessionType: pkg.sessionType, singleTitle: pkg.name, bookingPageId: null,
        })
        // Tie the assignment back to the plan that paid for it.
        if (grantOwnerId && clientPackageId) {
          await tx.clientPackage.update({
            where: { id: clientPackageId },
            data: { membershipPurchaseId: grantOwnerId },
          })
        }
      }
    } else if (item.kind === 'PRODUCT' && item.productId) {
      const prod = await tx.product.findFirst({ where: { id: item.productId, trainerId: args.trainerId }, select: { id: true } })
      if (!prod) continue
      for (let i = 0; i < qty; i++) {
        // Take stock per unit. A membership that's already been paid for is
        // still granted if the shelf is empty — the trainer owes them the item
        // either way — but the count never goes negative.
        await takeStock(tx, item.productId, { clientId: args.clientId, note: `Package: ${membership.name}` })
        await tx.productRequest.create({
          data: { clientId: args.clientId, productId: item.productId, status: 'FULFILLED', fulfilledAt: now, note: `Package: ${membership.name}` },
        })
      }
    } else if (item.kind === 'CLASS' && item.classRunId) {
      // One place per class item, enrolled post-commit.
      classGrants.push({ classRunId: item.classRunId })
    }
  }

  return { classGrants, membershipPurchaseId: purchase.id }
}

/**
 * Re-grant the membership's `regrantOnRenewal` PRODUCT items for a new cycle.
 *
 * The flag has existed on MembershipItem since the model was written and has
 * never been read by anything. It answers the obvious question about a bundle
 * that includes a bag of treats: do they get one bag ever, or one every month?
 *
 * PRODUCTS ONLY, deliberately. Re-granting a package or a class place every
 * cycle would quietly re-enrol somebody into a course they are already in and
 * pile up assignments nobody asked for; a consumable is the only thing where
 * "again this month" is what the words mean.
 *
 * Idempotent on the caller's side: it runs from invoice.paid, which is guarded
 * by the event ledger and the MembershipInvoice natural key, so one cycle can
 * only ever produce one set of grants.
 */
export async function regrantRenewalItems(
  tx: Tx,
  args: { membershipId: string; trainerId: string; clientId: string },
): Promise<number> {
  const membership = await tx.membership.findUnique({
    where: { id: args.membershipId },
    include: { items: { where: { regrantOnRenewal: true }, orderBy: { order: 'asc' } } },
  })
  // Defence in depth — the invoice is already scoped to this trainer's account.
  if (!membership || membership.trainerId !== args.trainerId) return 0

  const now = new Date()
  let granted = 0

  for (const item of membership.items) {
    if (item.kind !== 'PRODUCT' || !item.productId) continue
    const prod = await tx.product.findFirst({
      where: { id: item.productId, trainerId: args.trainerId },
      select: { id: true },
    })
    if (!prod) continue

    for (let i = 0; i < Math.max(1, item.quantity); i++) {
      // Same rule as first fulfilment: an empty shelf still owes them the item,
      // but the count never goes negative.
      await takeStock(tx, item.productId, { clientId: args.clientId, note: `Package renewal: ${membership.name}` })
      await tx.productRequest.create({
        data: {
          clientId: args.clientId,
          productId: item.productId,
          status: 'FULFILLED',
          fulfilledAt: now,
          note: `Package renewal: ${membership.name}`,
        },
      })
      granted++
    }
  }

  return granted
}

/**
 * Post-commit: enrol the buyer into each included class. Best-effort — a full /
 * closed class logs and moves on rather than failing the whole fulfilment.
 * (Phase 1 auto-enrols; approval-gated classes are a fast-follow.)
 *
 * `membershipPurchaseId` stamps each seat with the plan that paid for it, so a
 * failed payment can pause the seat WITHOUT withdrawing it — withdrawing frees
 * the place for someone else, and a client whose card is replaced two days later
 * must get their own seat back.
 */
export async function enrolMembershipClasses(
  grants: MembershipClassGrant[],
  clientId: string,
  membershipPurchaseId?: string | null,
): Promise<void> {
  for (const g of grants) {
    try {
      const r = await enrollInRun({ classRunId: g.classRunId, clientId, dogId: null, type: 'FULL', source: 'SELF_SERVE' })
      if (membershipPurchaseId && r?.enrollmentId) {
        await prisma.classEnrollment.update({
          where: { id: r.enrollmentId },
          data: { membershipPurchaseId },
        })
      }
    } catch (err) {
      console.error('[membership] class enrol failed', g.classRunId, err instanceof Error ? err.message : err)
    }
  }
}
