import { LIVE_SUBSCRIPTION_STATUSES } from '@/lib/membership-access'
import type { Prisma } from '@/generated/prisma'

// When is a PACKAGE "past"?
//
// The same question ./../packages/past-packages.ts answers for 1:1 sessions,
// and deliberately the same answer, because the two lists sit next to each
// other in the nav and a trainer should not have to hold two rules.
//
// A package has no date of its own. It is a thing you sell, and it can sit
// there unsold for a year without being finished. So the only honest signal is
// what it is DOING:
//
//   • Never bought              → CURRENT. It is for sale and waiting for its
//                                 first client; a brand new package is not a
//                                 finished one.
//   • Anyone still on it        → CURRENT.
//   • Everyone who bought it
//     has since ended           → PAST.
//
// Note what this is NOT. Unpublished does not mean past — a draft is something
// you have not finished writing, not something you have finished selling, and
// the list already badges it "Draft". Keeping the two apart means "Past" can
// be trusted to mean "this ran its course".

/** Purchase statuses that mean somebody is still on the package. */
const LIVE = new Set<string>(LIVE_SUBSCRIPTION_STATUSES)

/**
 * Which of these memberships have run their course.
 *
 * One query for the lot rather than one per row — the list can be long, and
 * this runs on every page load.
 */
export async function pastMembershipIds(
  db: Prisma.TransactionClient,
  membershipIds: string[],
): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set()

  const purchases = await db.membershipPurchase.groupBy({
    by: ['membershipId', 'status'],
    where: { membershipId: { in: membershipIds } },
    _count: { _all: true },
  })

  const everBought = new Set<string>()
  const stillLive = new Set<string>()
  for (const row of purchases) {
    everBought.add(row.membershipId)
    if (LIVE.has(row.status)) stillLive.add(row.membershipId)
  }

  return new Set(membershipIds.filter(id => everBought.has(id) && !stillLive.has(id)))
}
