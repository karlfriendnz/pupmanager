// Holding the slot while they answer.
//
// ── The decision, and why ───────────────────────────────────────────────────
//
// A client picks 2pm and then has five questions in front of them. Between
// those two moments the slot is in limbo, and there are only two options:
//
//   • Don't hold it — and 2pm can vanish under somebody who is doing exactly
//     what they were asked to do. They finish the form and are told no.
//   • Hold it — and an abandoned form takes 2pm out of the diary for ever
//     unless something gives it back.
//
// We hold it, with a short expiry, and give it back automatically. That is what
// people expect from booking anything else, and it is the only option where the
// person who followed the instructions is not the one who loses. The expiry is
// short (BOOKING_HOLD_MINUTES) because the form is a STEP OF THE WIZARD, not a
// screen they are sent away to.
//
// ── The three rules that make a hold safe ───────────────────────────────────
//
//  1. A hold is NOT a TrainingSession. It lives in its own table, and nothing
//     that draws the trainer's calendar, counts bookings, invoices, reports or
//     syncs to Google knows this table exists. A held slot therefore cannot be
//     shown to anybody as a confirmed booking, because there is no row of the
//     shape those screens read.
//
//  2. Expiry is enforced ON READ. Every query below filters `expiresAt > now`,
//     so a hold that lapsed thirty seconds ago is already bookable by somebody
//     else whether or not any sweep has run. The cron
//     (api/cron/booking-holds) only DELETES the dead rows; it is housekeeping,
//     never the thing that frees a slot. A sweep that were load-bearing would
//     mean a slot stayed locked for up to a whole cron interval after it should
//     have been free.
//
//  3. Your own hold never blocks you. Every read takes an `excludeClientId`, so
//     the client who is holding 2pm still sees 2pm, and the server-side
//     re-validation on their own confirm doesn't refuse them their own slot.
import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma'
import { BOOKING_HOLD_MINUTES, BOOKING_HOLD_PAYMENT_MINUTES, type GateAnswers } from './booking-gate'

/** A live hold, in the shape the busy-interval maths wants. */
export interface HoldBusy {
  id: string
  slotAt: Date
  durationMins: number
  bufferMins: number
}

/** Who must NOT be blocked by their own claim, and when "now" is. */
export interface HoldReadOptions {
  /** Holds belonging to this client are ignored — see rule 3. */
  excludeClientId?: string | null
  /** One specific hold ignored (the one being confirmed right now). */
  excludeHoldId?: string | null
  now?: Date
}

export function holdExpiry(from: Date = new Date(), minutes = BOOKING_HOLD_MINUTES): Date {
  return new Date(from.getTime() + minutes * 60_000)
}

/**
 * The holds that currently make a slot unavailable, over one window.
 *
 * `consumedAt: null` matters as much as the expiry: once a hold has become a
 * real booking the TrainingSession is what occupies the slot, and counting both
 * would make the trainer's own diary look double-booked to the picker.
 */
export async function liveHolds(
  trainerId: string,
  from: Date,
  to: Date,
  opts: HoldReadOptions = {},
  db: Pick<typeof prisma, 'bookingHold'> = prisma,
): Promise<HoldBusy[]> {
  const now = opts.now ?? new Date()
  const rows = await db.bookingHold.findMany({
    where: {
      trainerId,
      slotAt: { gte: from, lte: to },
      consumedAt: null,
      // THE read-side expiry. Not a cron's job — see rule 2.
      expiresAt: { gt: now },
      ...(opts.excludeClientId ? { NOT: { clientId: opts.excludeClientId } } : {}),
      ...(opts.excludeHoldId ? { id: { not: opts.excludeHoldId } } : {}),
    },
    select: { id: true, slotAt: true, durationMins: true, bufferMins: true },
  })
  return rows
}

/** One live, unconsumed hold by id — or null if it has lapsed since it was made. */
export async function liveHold(
  holdId: string,
  now: Date = new Date(),
  db: Pick<typeof prisma, 'bookingHold'> = prisma,
) {
  return db.bookingHold.findFirst({
    where: { id: holdId, consumedAt: null, expiresAt: { gt: now } },
  })
}

/**
 * Claim a slot.
 *
 * The caller has already checked the slot is bookable (with the holds of OTHER
 * clients counted in, via liveHolds). This then re-reads immediately after
 * writing and stands down if somebody else's claim on the same slot is older,
 * which closes the gap between those two statements to about as small as it can
 * be made without locking the trainer's whole diary. The final booking
 * re-validates anyway, so the worst outcome of losing this race is the honest
 * "that time's just been taken" the routes already say.
 */
export async function createBookingHold(args: {
  trainerId: string
  clientId: string | null
  packageId?: string | null
  bookingPageId?: string | null
  slotAt: Date
  durationMins: number
  bufferMins?: number
  formId?: string | null
  stepId?: string | null
  now?: Date
}): Promise<{ ok: true; hold: { id: string; expiresAt: Date } } | { ok: false; reason: 'taken' }> {
  const now = args.now ?? new Date()
  const hold = await prisma.bookingHold.create({
    data: {
      trainerId: args.trainerId,
      clientId: args.clientId,
      packageId: args.packageId ?? null,
      bookingPageId: args.bookingPageId ?? null,
      slotAt: args.slotAt,
      durationMins: args.durationMins,
      bufferMins: Math.max(0, args.bufferMins ?? 0),
      formId: args.formId ?? null,
      stepId: args.stepId ?? null,
      expiresAt: holdExpiry(now),
    },
    select: { id: true, expiresAt: true, createdAt: true },
  })

  const rival = await prisma.bookingHold.findFirst({
    where: {
      trainerId: args.trainerId,
      slotAt: args.slotAt,
      consumedAt: null,
      expiresAt: { gt: now },
      id: { not: hold.id },
      // A first-come rule needs a tie-break that both sides agree on. createdAt
      // then id: two rows written in the same millisecond still order the same
      // way whichever of them is asking.
      OR: [{ createdAt: { lt: hold.createdAt } }, { createdAt: hold.createdAt, id: { lt: hold.id } }],
    },
    select: { id: true },
  })
  if (rival) {
    await prisma.bookingHold.delete({ where: { id: hold.id } }).catch(() => {})
    return { ok: false, reason: 'taken' }
  }

  return { ok: true, hold: { id: hold.id, expiresAt: hold.expiresAt } }
}

/**
 * Store the answers that opened the gate.
 *
 * Written when the FORM STEP is finished, not when a payment succeeds. Somebody
 * whose card is declined has just typed five things, and sending them back to an
 * empty form is the worst version of this. The retry reads them straight back
 * off the hold.
 */
export async function saveHoldAnswers(
  holdId: string,
  answers: GateAnswers,
  now: Date = new Date(),
): Promise<void> {
  await prisma.bookingHold.update({
    where: { id: holdId },
    data: { answers: answers as unknown as Prisma.InputJsonValue, answeredAt: now },
  })
}

/**
 * Give the slot back.
 *
 * Called when somebody steps BACK to the time picker — the alternative is their
 * own abandoned claim hiding the very slot they are trying to change to, for the
 * rest of the expiry.
 */
export async function releaseBookingHold(holdId: string, clientId: string | null): Promise<void> {
  await prisma.bookingHold
    .deleteMany({ where: { id: holdId, ...(clientId ? { clientId } : {}) } })
    .catch(() => {})
}

/** Give it longer, because a card is now involved. See BOOKING_HOLD_PAYMENT_MINUTES. */
export async function extendHoldForPayment(holdId: string, now: Date = new Date()): Promise<void> {
  await prisma.bookingHold
    .update({ where: { id: holdId }, data: { expiresAt: holdExpiry(now, BOOKING_HOLD_PAYMENT_MINUTES) } })
    .catch(() => {})
}

/**
 * The booking happened — the hold's job is done.
 *
 * Marked rather than deleted so the cron carries it away on its own schedule and
 * a webhook redelivery finds a row to be idempotent about instead of a mystery.
 */
export async function consumeBookingHold(
  holdId: string,
  db: Pick<Prisma.TransactionClient, 'bookingHold'> = prisma,
  now: Date = new Date(),
): Promise<void> {
  await db.bookingHold.update({ where: { id: holdId }, data: { consumedAt: now } }).catch(() => {})
}

/**
 * Housekeeping. Deletes holds that stopped mattering — lapsed, or long since
 * turned into real bookings.
 *
 * NOT what frees a slot (rule 2). If this never ran again, every read would
 * still treat an expired hold as gone; the table would just grow.
 */
export async function sweepBookingHolds(now: Date = new Date()): Promise<{ deleted: number }> {
  const consumedCutoff = new Date(now.getTime() - 24 * 60 * 60_000)
  const res = await prisma.bookingHold.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now }, consumedAt: null },
        { consumedAt: { lt: consumedCutoff } },
      ],
    },
  })
  return { deleted: res.count }
}
