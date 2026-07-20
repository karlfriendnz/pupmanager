// Shared helpers for the Calendly-style booking page: lazy config access and
// the single place that turns a chosen slot into real calendar rows. Both the
// public POST endpoint (an existing client booking themselves) and the
// accept-enquiry flow (a prospect being converted to a client) call
// materializeBooking so a booked slot is identical downstream however it
// arrived.
import type { Prisma, SessionType } from '@/generated/prisma'
import { prisma } from './prisma'
import { createBookingAssignment, generateSessionDates, sessionTitle } from './self-book'
import type { BookingPageConfig } from './booking-slots'

type Tx = Prisma.TransactionClient

// Mirror the schema defaults for a freshly-created page.
export const BOOKING_PAGE_DEFAULTS = {
  enabled: false,
  slotLengthMins: 60,
  slotIntervalMins: 60,
  requiresApproval: true,
  minNoticeHours: 12,
  windowDays: 28,
  sessionType: 'IN_PERSON' as SessionType,
}

/** Turn a page name into a URL-safe slug segment. */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'book'
}

/**
 * A booking-page slug unique within the trainer. Appends -2, -3 … on clash.
 * `excludeId` lets a rename keep its own slug without colliding with itself.
 */
export async function uniqueBookingSlug(trainerId: string, desired: string, excludeId?: string): Promise<string> {
  const base = slugifyName(desired)
  let slug = base
  for (let n = 2; ; n++) {
    const clash = await prisma.bookingPage.findFirst({
      where: { trainerId, slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
    slug = `${base}-${n}`
  }
}

/** Slot-generation config slice, from a page row + the trainer's timezone. */
export function bookingConfig(
  page: {
    windowDays: number
    slotLengthMins: number
    slotIntervalMins: number
    minNoticeHours: number
    availDays?: unknown
    availStartTime?: string | null
    availEndTime?: string | null
  },
  tz: string,
  // Turnaround gap the booked session will carry — the page's package's
  // bufferMins. Omit (or 0) for a single-session page with no package.
  slotBufferMins = 0,
): BookingPageConfig {
  // The page's own availability window applies only when both times are set.
  const days = Array.isArray(page.availDays) ? (page.availDays as number[]).filter(d => d >= 1 && d <= 7) : []
  const availability =
    page.availStartTime && page.availEndTime && days.length > 0
      ? { days, startTime: page.availStartTime, endTime: page.availEndTime }
      : null

  return {
    tz,
    windowDays: page.windowDays,
    slotLengthMins: page.slotLengthMins,
    slotIntervalMins: page.slotIntervalMins,
    minNoticeHours: page.minNoticeHours,
    slotBufferMins,
    availability,
  }
}

interface MaterializeArgs {
  trainerId: string
  clientId: string
  dogId: string | null
  slotAt: Date
  // The package this booking kicks off, if the page offers one. Null = single
  // one-off session of `singleDurationMins`/`singleSessionType`.
  pkg: { id: string; name: string; sessionCount: number; weeksBetween: number; durationMins: number; bufferMins?: number; sessionType: SessionType } | null
  singleDurationMins: number
  singleSessionType: SessionType
  singleTitle: string
  // The booking page this came from — stamped on the session(s) for automations.
  bookingPageId: string | null
}

/**
 * Create the booked calendar rows inside a transaction. Returns the resulting
 * ClientPackage id (or null for a single session) AND the ids of the sessions
 * created, so the caller can mirror just these to Google Calendar post-commit.
 * With a package the chosen slot is session 1 and the rest auto-place on the
 * package cadence; with no package a single TrainingSession lands on the slot.
 */
export async function materializeBooking(
  tx: Tx,
  args: MaterializeArgs,
): Promise<{ clientPackageId: string | null; sessionIds: string[] }> {
  if (args.pkg) {
    const dates = generateSessionDates(args.slotAt, args.pkg.sessionCount, args.pkg.weeksBetween)
    const clientPackageId = await createBookingAssignment(tx, {
      trainerId: args.trainerId,
      clientId: args.clientId,
      packageId: args.pkg.id,
      dogId: args.dogId,
      pkg: args.pkg,
      sessionDates: dates,
      bookingPageId: args.bookingPageId,
    })
    // createBookingAssignment uses createMany (no ids) — re-read the rows it
    // just created (visible in-tx) by the assignment id.
    const created = await tx.trainingSession.findMany({
      where: { clientPackageId },
      select: { id: true },
    })
    return { clientPackageId, sessionIds: created.map((s) => s.id) }
  }

  const session = await tx.trainingSession.create({
    data: {
      trainerId: args.trainerId,
      clientId: args.clientId,
      dogId: args.dogId,
      bookingPageId: args.bookingPageId,
      title: sessionTitle(args.singleTitle, 1, 0),
      scheduledAt: args.slotAt,
      durationMins: args.singleDurationMins,
      sessionType: args.singleSessionType,
    },
    select: { id: true },
  })
  return { clientPackageId: null, sessionIds: [session.id] }
}
