import type { Prisma, MembershipPurchaseStatus } from '@/generated/prisma'

// WHAT A MEMBERSHIP'S STATUS MEANS FOR ACCESS — the one place this is decided.
//
// This rule gets copied inconsistently the moment it lives in more than one
// file: one screen hides a paused package, another still lets them book off it,
// and the client ends up half-locked-out in a way nobody can reproduce. Every
// call site asks these functions instead of testing the status itself.
//
// THE RULE (Karl, 2026-08-01, replacing the 2026-07-27 one): a failed payment
// does NOT stop access on the spot. The plan goes PAST_DUE and the client is
// told straight away, but everything the package granted keeps working for two
// weeks while Stripe retries.
//
// Why it changed: Stripe retries a declined card for roughly two weeks, and the
// overwhelming majority of failures are an expired card someone replaces within
// days. Stopping on the first miss meant cutting a client out of the classes
// they had paid for all year over a card they were about to fix — and doing it
// before the payment had actually, finally failed.
//
// The window runs from the FIRST failure of an episode, not the latest retry,
// or every retry would push the deadline out and the grace would never end.
// Stripe giving up early still ends it immediately: `unpaid` maps to CANCELLED,
// which grants nothing whatever the grace date says.
//
// Nothing here deletes anything either way — pausing is a reversible timestamp
// on the granted rows, and restoring is the same timestamp cleared.

/** How long a client keeps everything after a payment first fails. */
export const MEMBERSHIP_GRACE_DAYS = 14

/** The end of the grace window for a failure that happened at `firstFailedAt`. */
export function graceDeadline(firstFailedAt: Date): Date {
  return new Date(firstFailedAt.getTime() + MEMBERSHIP_GRACE_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Does a membership in this state entitle the client to what it granted?
 *
 * PAST_DUE now depends on a DATE, so this takes the purchase's grace deadline.
 * It is a required argument rather than an optional one on purpose: every call
 * site had to be visited when the rule changed, and a default would have let
 * one of them keep quietly cutting people off.
 */
export function membershipGrantsAccess(
  status: MembershipPurchaseStatus,
  /** MembershipPurchase.accessGraceUntil. Null means no grace is running. */
  graceUntil: Date | null,
  now: Date = new Date(),
): boolean {
  switch (status) {
    // Paid and current.
    case 'ACTIVE':
      return true
    // Cancelled but still inside a period they have already paid for. They keep
    // everything until the date — that is what "you'll keep it until the 14th"
    // on the cancel screen promises.
    case 'CANCELLING':
      return true
    // A payment failed and Stripe is still retrying. They keep everything until
    // the grace window closes. A null deadline means no window was ever opened
    // — which includes every row that went PAST_DUE under the old rule, so this
    // change does not hand access back to anyone who has already lost it.
    case 'PAST_DUE':
      return graceUntil != null && graceUntil.getTime() > now.getTime()
    // Stripe-side pause, trainer/dispute-driven suspension, a finished plan, or
    // a trainer who has left PupManager entirely.
    case 'PAUSED':
    case 'CANCELLED':
    case 'LAPSED':
    case 'ORPHANED':
      return false
    default:
      // A status we do not recognise must not silently grant access.
      return false
  }
}

/**
 * Plain words for why a client's plan is not currently giving them anything.
 * Null when they do have access.
 *
 * Never shaming, and never silent: losing access with no explanation is the
 * worst version of this, so every non-access state has a sentence and — where
 * the client can actually do something — says what.
 */
export function accessPausedReason(
  status: MembershipPurchaseStatus,
  graceUntil: Date | null = null,
  now: Date = new Date(),
): string | null {
  switch (status) {
    case 'PAST_DUE': {
      // Still inside the window: they have NOT lost anything, and saying "this
      // plan is paused" when it isn't would send them chasing a problem that
      // hasn't happened. Give them the date instead — it is the one piece of
      // information that changes what they do.
      const inGrace = graceUntil != null && graceUntil.getTime() > now.getTime()
      if (inGrace) {
        const by = graceUntil!.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })
        return `Your payment didn’t go through. We’ll keep trying — update your card before ${by} to avoid losing access.`
      }
      return 'Your payment didn’t go through, so this plan is paused. Update your card to turn it back on.'
    }
    case 'PAUSED':
      return 'This plan is paused.'
    case 'ORPHANED':
      return 'Your trainer has stopped taking payments through PupManager, so this plan has ended. You haven’t been charged again.'
    case 'CANCELLED':
    case 'LAPSED':
      return 'This plan has ended.'
    default:
      return null
  }
}

/** The statuses a live subscription can be in — used to find them for a trainer. */
export const LIVE_SUBSCRIPTION_STATUSES: MembershipPurchaseStatus[] = ['ACTIVE', 'PAST_DUE', 'CANCELLING', 'PAUSED']

/**
 * Pause everything a membership granted.
 *
 * Suspends rather than deletes, so restoring is exact: the ClientPackage keeps
 * its sessions and the ClassEnrollment keeps its SEAT. Withdrawing an enrolment
 * instead would free the place for someone else, and a client whose card is
 * replaced two days later would come back to find it sold.
 *
 * Idempotent — re-suspending an already-suspended grant changes nothing, which
 * matters because a redelivered invoice.payment_failed lands here again.
 */
export async function suspendMembershipGrants(
  tx: Prisma.TransactionClient,
  membershipPurchaseId: string,
  now: Date = new Date(),
): Promise<{ packages: number; enrolments: number }> {
  const [packages, enrolments] = await Promise.all([
    tx.clientPackage.updateMany({
      where: { membershipPurchaseId, suspendedAt: null },
      data: { suspendedAt: now },
    }),
    tx.classEnrollment.updateMany({
      // Never touch a seat they have already given up themselves.
      where: { membershipPurchaseId, suspendedAt: null, withdrawnAt: null },
      data: { suspendedAt: now },
    }),
  ])
  return { packages: packages.count, enrolments: enrolments.count }
}

/**
 * Give it all back. The mirror of suspendMembershipGrants, and the path that
 * runs every time a Stripe retry succeeds — which, with access stopping on the
 * first failure, is often.
 *
 * Clears the flag on EVERY grant of this purchase rather than only the ones a
 * particular failure paused, so a partially-suspended state can never survive.
 */
export async function restoreMembershipGrants(
  tx: Prisma.TransactionClient,
  membershipPurchaseId: string,
): Promise<{ packages: number; enrolments: number }> {
  const [packages, enrolments] = await Promise.all([
    tx.clientPackage.updateMany({
      where: { membershipPurchaseId, suspendedAt: { not: null } },
      data: { suspendedAt: null },
    }),
    tx.classEnrollment.updateMany({
      where: { membershipPurchaseId, suspendedAt: { not: null } },
      data: { suspendedAt: null },
    }),
  ])
  return { packages: packages.count, enrolments: enrolments.count }
}

/**
 * The Prisma filter for "grants the client can actually use right now".
 *
 * Exported as a constant so a read path cannot half-remember the rule. A
 * trainer-side query deliberately does NOT use this: a paused client must stay
 * visible on the roster and the schedule, because the trainer still needs to
 * know who was coming and to have the conversation.
 */
export const NOT_SUSPENDED = { suspendedAt: null } as const

/**
 * The same rule for TrainingSession, which has no `suspendedAt` of its own — a
 * session is suspended when the ClientPackage it belongs to is.
 *
 * The `OR` matters: most sessions have NO clientPackage (a one-off booking, a
 * trainer-created session), and those must never be filtered out. Writing this
 * as a bare relation filter would silently hide every unattached session from
 * the client — a far worse bug than the one it is fixing.
 */
// Not `as const`: that makes the OR array readonly, which Prisma's generated
// WhereInput types reject.
export const SESSIONS_NOT_SUSPENDED: {
  OR: ({ clientPackageId: null } | { clientPackage: { suspendedAt: null } })[]
} = {
  OR: [
    { clientPackageId: null },
    { clientPackage: { suspendedAt: null } },
  ],
}
