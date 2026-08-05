import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma'
import { offeringVisibleWhere, offeringVisibleRelationWhere } from './offering-visibility'
import { loadPublishedMemberships } from './client-memberships'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from './feature-flags'

/**
 * "Is there anything this client can actually book right now?"
 *
 * The client home shows a Bookings tile that opens /my-availability. When that
 * page has nothing to offer it draws its own empty state, so the tile was a
 * shortcut to a dead end — Karl, 2026-08-06: "booking button should not show if
 * there is nothing to book".
 *
 * The FACT, not a proxy for it: this counts THE SAME FOUR THINGS the booking
 * wizard counts in its own `nothingToBook`
 * (`src/app/(client)/my-availability/booking-wizard.tsx`) —
 *
 *     packages.length === 0 && classes.length === 0
 *       && events.length === 0 && memberships.length === 0
 *
 * — and it counts them with THE SAME where-clauses, which is why those clauses
 * live here and are imported by /my-availability rather than written twice. A
 * second copy of "visible, self-bookable, not already fully enrolled" is exactly
 * how the tile and the page would come to disagree.
 *
 * Classes and events are one query: the page splits open runs into the two lists
 * with `isEventPackage`, so `classes.length + events.length === openRuns.length`
 * and the split can't change whether the total is zero.
 */

/**
 * Self-bookable 1-on-1 offerings.
 *
 * `isGroup: false` is load-bearing — a group offering is booked by its RUN and
 * its own timetable, never off the trainer's open hours.
 */
export function selfBookablePackagesWhere(
  trainerId: string,
  now: Date = new Date(),
): Prisma.PackageWhereInput {
  return { trainerId, clientSelfBook: true, isGroup: false, ...offeringVisibleWhere(now) }
}

/**
 * Group runs (classes AND events) still open to this client.
 *
 * `enrolledRunIds` are the runs they hold a FULL place in — nothing left to
 * book. A drop-in covers ONE session, so it must NOT take the run off the list.
 */
export function openClassRunsWhere(
  trainerId: string,
  enrolledRunIds: readonly string[],
  now: Date = new Date(),
): Prisma.ClassRunWhereInput {
  return {
    trainerId,
    status: { in: ['SCHEDULED', 'RUNNING'] },
    id: { notIn: enrolledRunIds.length ? [...enrolledRunIds] : ['__none__'] },
    // …with at least one LIVE session still to come. A run whose remaining
    // weeks have all been called off is not something to offer a place in.
    sessions: { some: { scheduledAt: { gte: now }, cancelledAt: null } },
    ...offeringVisibleRelationWhere(now),
  }
}

/** The runs this client already holds a FULL place in. */
export async function fullyEnrolledRunIds(clientId: string): Promise<string[]> {
  const rows = await prisma.classEnrollment.findMany({
    where: { clientId, status: { in: ['ENROLLED', 'WAITLISTED', 'COMPLETED'] } },
    select: { classRunId: true, type: true },
  })
  return rows.filter(e => e.type === 'FULL').map(e => e.classRunId)
}

/**
 * True when /my-availability would show this client something to book, false
 * when it would draw its empty state.
 *
 * Cheap on purpose: two counts, and the memberships load only when the first
 * two came back empty (and only when packages aren't hidden from clients at
 * all, which is the current flag state).
 */
export async function hasBookableOfferings(
  args: { trainerId: string; clientId: string },
  now: Date = new Date(),
): Promise<boolean> {
  const enrolledRunIds = await fullyEnrolledRunIds(args.clientId)
  const [packageCount, runCount] = await Promise.all([
    prisma.package.count({ where: selfBookablePackagesWhere(args.trainerId, now) }),
    prisma.classRun.count({ where: openClassRunsWhere(args.trainerId, enrolledRunIds, now) }),
  ])
  if (packageCount > 0 || runCount > 0) return true

  // Memberships are a whole offering TYPE in that flow, so they keep the page
  // alive on their own — but only while clients can see them at all.
  if (PACKAGES_HIDDEN_FROM_CLIENTS) return false
  const memberships = await loadPublishedMemberships(args.trainerId, args.clientId)
  return memberships.length > 0
}
