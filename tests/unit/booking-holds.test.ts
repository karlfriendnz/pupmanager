import { describe, it, expect, vi, beforeEach } from 'vitest'

// Holding the slot while they answer.
//
// The single most important property here is that EXPIRY IS ENFORCED ON READ.
// A slot whose hold lapsed thirty seconds ago must already be bookable by
// somebody else even if no sweep has run — otherwise a distracted person takes
// 2pm out of the diary for up to a whole cron interval, which is the exact
// failure the hold was introduced to prevent.
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteOne: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingHold: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      create: h.create,
      update: h.update,
      delete: h.deleteOne,
      deleteMany: h.deleteMany,
    },
  },
}))

import {
  liveHolds,
  liveHold,
  createBookingHold,
  releaseBookingHold,
  extendHoldForPayment,
  consumeBookingHold,
  saveHoldAnswers,
  sweepBookingHolds,
  holdExpiry,
} from '@/lib/booking-holds'
import { BOOKING_HOLD_MINUTES, BOOKING_HOLD_PAYMENT_MINUTES } from '@/lib/booking-gate'

const TRAINER = 'tr_1'
const CLIENT = 'cl_1'
const NOW = new Date('2026-08-06T10:00:00.000Z')
const FROM = new Date('2026-08-06T00:00:00.000Z')
const TO = new Date('2026-09-03T00:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.findFirst.mockResolvedValue(null)
  h.create.mockResolvedValue({ id: 'hold_new', expiresAt: NOW, createdAt: NOW })
  h.update.mockResolvedValue({})
  h.deleteOne.mockResolvedValue({})
  h.deleteMany.mockResolvedValue({ count: 0 })
})

describe('liveHolds — expiry is applied by the QUERY, not by a sweep', () => {
  it('asks only for holds that have not expired yet', async () => {
    await liveHolds(TRAINER, FROM, TO, { now: NOW })
    const where = h.findMany.mock.calls[0][0].where
    expect(where.expiresAt).toEqual({ gt: NOW })
  })

  // A hold whose booking already happened must stop counting: the session
  // occupies the slot now, and counting both makes the picker see the trainer's
  // own diary as double-booked.
  it('ignores holds that have already become bookings', async () => {
    await liveHolds(TRAINER, FROM, TO, { now: NOW })
    expect(h.findMany.mock.calls[0][0].where.consumedAt).toBeNull()
  })

  it('is scoped to one trainer and the window asked for', async () => {
    await liveHolds(TRAINER, FROM, TO, { now: NOW })
    const where = h.findMany.mock.calls[0][0].where
    expect(where.trainerId).toBe(TRAINER)
    expect(where.slotAt).toEqual({ gte: FROM, lte: TO })
  })

  // Rule 3: your own claim never blocks you. Otherwise the client holding 2pm
  // is shown a picker with 2pm missing and is refused their own slot at Confirm.
  it('excludes the asking client’s own holds', async () => {
    await liveHolds(TRAINER, FROM, TO, { excludeClientId: CLIENT, now: NOW })
    expect(h.findMany.mock.calls[0][0].where.NOT).toEqual({ clientId: CLIENT })
  })

  it('…and everybody else’s still count', async () => {
    await liveHolds(TRAINER, FROM, TO, { now: NOW })
    expect(h.findMany.mock.calls[0][0].where.NOT).toBeUndefined()
  })

  it('can exclude one specific hold — the one being confirmed', async () => {
    await liveHolds(TRAINER, FROM, TO, { excludeHoldId: 'hold_9', now: NOW })
    expect(h.findMany.mock.calls[0][0].where.id).toEqual({ not: 'hold_9' })
  })

  // What a hold gives back is a busy interval, not a session: it carries the
  // duration and the turnaround gap so the slot maths matches the booking that
  // will replace it.
  it('returns the slot, its duration and its buffer', async () => {
    h.findMany.mockResolvedValueOnce([
      { id: 'hold_1', slotAt: new Date('2026-08-07T02:00:00.000Z'), durationMins: 60, bufferMins: 15 },
    ])
    expect(await liveHolds(TRAINER, FROM, TO, { now: NOW })).toEqual([
      { id: 'hold_1', slotAt: new Date('2026-08-07T02:00:00.000Z'), durationMins: 60, bufferMins: 15 },
    ])
  })
})

describe('liveHold — one claim, by id', () => {
  it('will not return a lapsed or consumed one', async () => {
    await liveHold('hold_1', NOW)
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      id: 'hold_1', consumedAt: null, expiresAt: { gt: NOW },
    })
  })

  // The "it lapsed while they were typing" case: the caller gets null and can
  // say so plainly instead of letting them finish and fail at the end.
  it('is null once it has expired', async () => {
    expect(await liveHold('hold_1', NOW)).toBeNull()
  })
})

describe('holdExpiry', () => {
  it('defaults to the short form window', () => {
    expect(holdExpiry(NOW).getTime() - NOW.getTime()).toBe(BOOKING_HOLD_MINUTES * 60_000)
  })
  it('takes the longer window when a card is involved', () => {
    expect(holdExpiry(NOW, BOOKING_HOLD_PAYMENT_MINUTES).getTime() - NOW.getTime())
      .toBe(BOOKING_HOLD_PAYMENT_MINUTES * 60_000)
  })
})

describe('createBookingHold', () => {
  it('claims the slot with the duration and buffer the session will occupy', async () => {
    const r = await createBookingHold({
      trainerId: TRAINER, clientId: CLIENT, packageId: 'pkg_1',
      slotAt: new Date('2026-08-07T02:00:00.000Z'), durationMins: 60, bufferMins: 15,
      formId: 'form_1', stepId: 'step_1', now: NOW,
    })
    expect(r.ok).toBe(true)
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      trainerId: TRAINER, clientId: CLIENT, packageId: 'pkg_1',
      durationMins: 60, bufferMins: 15, formId: 'form_1', stepId: 'step_1',
    })
  })

  // A hold is not a booking. Nothing here writes a session, an assignment or an
  // invoice, which is what stops a held slot ever being drawn on a calendar,
  // counted, or reported as confirmed.
  it('creates a hold and nothing else', async () => {
    await createBookingHold({
      trainerId: TRAINER, clientId: CLIENT, slotAt: NOW, durationMins: 60, now: NOW,
    })
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('stamps the short expiry', async () => {
    await createBookingHold({ trainerId: TRAINER, clientId: CLIENT, slotAt: NOW, durationMins: 60, now: NOW })
    expect(h.create.mock.calls[0][0].data.expiresAt.getTime())
      .toBe(NOW.getTime() + BOOKING_HOLD_MINUTES * 60_000)
  })

  // Two people tapping Continue on 2pm at the same instant. First claim wins;
  // the loser stands down and deletes its own row rather than leaving a second
  // live hold on one slot.
  it('stands down when somebody else claimed the same slot first', async () => {
    h.findFirst.mockResolvedValueOnce({ id: 'hold_theirs' })
    const r = await createBookingHold({
      trainerId: TRAINER, clientId: CLIENT, slotAt: NOW, durationMins: 60, now: NOW,
    })
    expect(r).toEqual({ ok: false, reason: 'taken' })
    expect(h.deleteOne).toHaveBeenCalledWith({ where: { id: 'hold_new' } })
  })

  it('only stands down for an OLDER live claim', async () => {
    await createBookingHold({ trainerId: TRAINER, clientId: CLIENT, slotAt: NOW, durationMins: 60, now: NOW })
    const where = h.findFirst.mock.calls[0][0].where
    expect(where.consumedAt).toBeNull()
    expect(where.expiresAt).toEqual({ gt: NOW })
    expect(where.id).toEqual({ not: 'hold_new' })
  })
})

describe('the rest of a hold’s life', () => {
  // Written when the FORM STEP finished, not when a payment succeeded — a
  // declined card must send somebody back to a filled-in form.
  it('saves the answers onto the hold', async () => {
    await saveHoldAnswers('hold_1', { q1: 'no' }, NOW)
    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
      data: { answers: { q1: 'no' }, answeredAt: NOW },
    })
  })

  // Somebody tapping Back to change the time must not be blocked by their own
  // abandoned claim on the hour they are leaving.
  it('gives the slot back, scoped to its owner', async () => {
    await releaseBookingHold('hold_1', CLIENT)
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { id: 'hold_1', clientId: CLIENT } })
  })

  it('extends only as far as the payment window', async () => {
    await extendHoldForPayment('hold_1', NOW)
    expect(h.update.mock.calls[0][0].data.expiresAt.getTime())
      .toBe(NOW.getTime() + BOOKING_HOLD_PAYMENT_MINUTES * 60_000)
  })

  it('marks a hold consumed once the booking exists', async () => {
    await consumeBookingHold('hold_1', { bookingHold: { update: h.update } } as never, NOW)
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'hold_1' }, data: { consumedAt: NOW } })
  })

  // These run alongside a booking that has already happened. None may throw at
  // its caller and turn a successful booking into an error.
  it('none of them fail their caller', async () => {
    h.update.mockRejectedValue(new Error('gone'))
    h.deleteMany.mockRejectedValue(new Error('gone'))
    await expect(releaseBookingHold('hold_1', CLIENT)).resolves.toBeUndefined()
    await expect(extendHoldForPayment('hold_1', NOW)).resolves.toBeUndefined()
    await expect(consumeBookingHold('hold_1', { bookingHold: { update: h.update } } as never, NOW)).resolves.toBeUndefined()
  })
})

describe('sweepBookingHolds — housekeeping, never the thing that frees a slot', () => {
  it('deletes lapsed holds and long-since-consumed ones', async () => {
    h.deleteMany.mockResolvedValueOnce({ count: 4 })
    expect(await sweepBookingHolds(NOW)).toEqual({ deleted: 4 })
    const or = h.deleteMany.mock.calls[0][0].where.OR
    expect(or[0]).toEqual({ expiresAt: { lt: NOW }, consumedAt: null })
    expect(or[1].consumedAt.lt.getTime()).toBe(NOW.getTime() - 24 * 60 * 60_000)
  })

  // The proof that the sweep is not load-bearing: a lapsed hold is already gone
  // from the read even when the sweep has deleted nothing at all.
  it('a lapsed hold is already invisible to the read before any sweep runs', async () => {
    h.deleteMany.mockResolvedValueOnce({ count: 0 }) // sweep found nothing
    await sweepBookingHolds(NOW)
    // …and the read still filters it out on its own.
    await liveHolds(TRAINER, FROM, TO, { now: NOW })
    expect(h.findMany.mock.calls[0][0].where.expiresAt).toEqual({ gt: NOW })
  })
})
