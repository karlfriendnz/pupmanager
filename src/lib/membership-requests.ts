// The trainer's side of "Request this" — the server half.
//
// A client looking at a package they can't check out — a recurring plan (no
// mandate layer yet) or one published without a price — can tap Request. That
// writes a MembershipRequest and fires a CLIENT_SHOP_ORDER notification. Miss
// the notification and the lead is gone, so the pending rows also have to be
// somewhere the trainer walks past: the dashboard's existing requests panel,
// beside the shop's product requests it was modelled on.
//
// The client-safe shapes and wording live in ./membership-request-shape, which
// has no prisma import so the panel can use them too.
import { prisma } from './prisma'
import { personLabel } from '@/lib/utils'
import type { Prisma } from '@/generated/prisma'
import type { MembershipInterval, MembershipRequestReasonValue, PendingMembershipRequest } from './membership-request-shape'

export type { MembershipRequestReasonValue, PendingMembershipRequest }

/**
 * Tenant guard for every read and write in this feature, in one place.
 *
 * Scoped on BOTH sides on purpose: the membership must be this trainer's AND
 * the client must be this trainer's. Either alone would be correct today, but a
 * ClientProfile is per (userId, trainerId) and one person can hold profiles with
 * several trainers — belt and braces means no future refactor of one side can
 * quietly open the other.
 */
export function trainerRequestScope(trainerId: string): Prisma.MembershipRequestWhereInput {
  return { membership: { trainerId }, client: { trainerId } }
}

/**
 * Every request still waiting on the trainer, oldest first — an unactioned one
 * is a lead going cold, so the one that has waited longest is at the top.
 */
export async function loadPendingMembershipRequests(trainerId: string): Promise<PendingMembershipRequest[]> {
  const rows = await prisma.membershipRequest.findMany({
    where: { status: 'PENDING', ...trainerRequestScope(trainerId) },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      reason: true,
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      membership: { select: { id: true, name: true, priceCents: true, cadence: true, interval: true } },
    },
  })

  return rows.map(r => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    reason: r.reason as MembershipRequestReasonValue,
    client: { id: r.client.id, name: personLabel(r.client.user) },
    membership: {
      id: r.membership.id,
      name: r.membership.name,
      priceCents: r.membership.priceCents,
      cadence: r.membership.cadence as 'ONE_OFF' | 'RECURRING',
      interval: r.membership.cadence === 'RECURRING'
        ? ((r.membership.interval ?? null) as MembershipInterval | null)
        : null,
    },
  }))
}

/**
 * How many people are waiting on each package, for the badge on the Packages
 * list. Only packages with at least one come back — the caller reads `.get(id)`
 * and renders nothing for undefined.
 */
export async function countPendingMembershipRequests(trainerId: string): Promise<Map<string, number>> {
  const grouped = await prisma.membershipRequest.groupBy({
    by: ['membershipId'],
    where: { status: 'PENDING', ...trainerRequestScope(trainerId) },
    _count: { _all: true },
  })
  return new Map(grouped.map(g => [g.membershipId, g._count._all]))
}
