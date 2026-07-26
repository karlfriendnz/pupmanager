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

  // Record the purchase. Phase 1 is ONE_OFF — no term / period. Recurring fills
  // committedUntil + currentPeriodEnd from the mandate billing run later.
  await tx.membershipPurchase.create({
    data: { membershipId: membership.id, trainerId: args.trainerId, clientId: args.clientId, paymentId: args.paymentId, sandbox: args.sandbox, status: 'ACTIVE' },
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
