import type { Prisma } from '@/generated/prisma'
import { startOfDayInTz, utcToZonedDateAndMinutes } from '@/lib/timezone'

// When an offering starts being visible to clients.
//
// `Package.visibleFrom` is the instant a trainer wants clients to start seeing
// it; null — the default, and what every offering built before this existed
// means — is "visible immediately". A trainer sets next term up in November and
// does not want it on the booking screen until enrolments open.
//
// ── This gate is SERVER-SIDE, everywhere, without exception ──────────────────
//
// A hidden offering must not be SENT to the browser at all. Filtering in the
// component would still ship the name, the price, the capacity and the run ids
// to anyone who opens devtools — and one of these surfaces is anonymous
// (the public booking page and the embed class list), where "the client" is
// whoever has the URL.
//
// There are eleven independent reads. They each write their own `where`, which
// is precisely why the predicate lives here instead of being retyped: a missed
// one is not a broken screen, it is a leak nobody notices.
//
// TRAINER-side reads must NOT use this. A trainer has to see everything they
// own, marked "not yet showing" — an offering that vanishes from its own list
// reads as data loss, and the trainer rebuilds it.

/**
 * A `Package` where-fragment. Spread into an existing where:
 *
 * ```ts
 * where: { trainerId, clientSelfBook: true, ...offeringVisibleWhere() }
 * ```
 */
export function offeringVisibleWhere(now: Date = new Date()): Prisma.PackageWhereInput {
  return {
    // Two branches rather than `{ not: { gt: now } }` because Postgres NULL
    // fails every comparison — an ungated offering would be excluded by its own
    // default, which is the loudest possible way to get this backwards.
    OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
  }
}

/**
 * The same rule as a RELATION filter, for the reads that reach an offering
 * through something else — a ClassRun, a MembershipItem, a BookingPage.
 *
 * ```ts
 * where: { trainerId, status: 'SCHEDULED', ...offeringVisibleRelationWhere() }
 * ```
 *
 * Note this is a `package: { ... }` filter on a REQUIRED relation, so it also
 * quietly refuses a run whose package row has gone — which is the right answer
 * for a client either way.
 */
export function offeringVisibleRelationWhere(
  now: Date = new Date(),
): { package: Prisma.PackageWhereInput } {
  return { package: offeringVisibleWhere(now) }
}

/**
 * The same rule applied to a row already in hand — for a read that fetched the
 * offering by id before it could filter, and for the trainer screens deciding
 * whether to show the "not yet showing" badge.
 */
export function isOfferingVisibleToClients(
  pkg: { visibleFrom: Date | null },
  now: Date = new Date(),
): boolean {
  return pkg.visibleFrom === null || pkg.visibleFrom.getTime() <= now.getTime()
}

/**
 * The trainer-side marker for an offering that is built but not yet showing.
 * Returns null — no badge at all — for the overwhelming majority that are
 * visible now.
 *
 * A trainer must never open their list and wonder where something went, so
 * nothing is ever hidden from them; it is labelled instead. The label carries
 * no DATE deliberately: rendering one would need the trainer's timezone in
 * every list loader, and the exact day is one tap away on the offering itself.
 *
 * Takes a Date or an ISO string so a server component can hand it either.
 */
export function notYetShowingBadge(
  visibleFrom: Date | string | null | undefined,
  now: Date = new Date(),
): { label: string; tone: 'warn' } | null {
  if (!visibleFrom) return null
  const at = visibleFrom instanceof Date ? visibleFrom : new Date(visibleFrom)
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null
  return { label: 'Not showing yet', tone: 'warn' }
}

// ─── Crossing between the trainer's calendar day and the stored instant ──────
//
// The trainer types a DAY ("show this from 1 December"). What is stored is the
// INSTANT that day begins for them, so every read is a plain instant
// comparison. These two are the only places the two representations meet —
// going through them is what stops a UTC-midnight column from publishing a Los
// Angeles trainer's term a day early.

/** `YYYY-MM-DD` in the trainer's zone → the instant that day starts. */
export function visibleFromInstant(dateStr: string | null | undefined, tz: string): Date | null {
  if (!dateStr) return null
  return startOfDayInTz(dateStr, tz)
}

/** The stored instant → the `YYYY-MM-DD` the trainer originally picked. */
export function visibleFromDateStr(visibleFrom: Date | null | undefined, tz: string): string | null {
  if (!visibleFrom) return null
  return utcToZonedDateAndMinutes(visibleFrom, tz).dateStr
}
