import { describe, it, expect, vi, beforeEach } from 'vitest'

// A hold has to actually remove the slot — in BOTH engines.
//
// There are two independent pieces of code that decide whether an hour is
// bookable: lib/client-availability (self-book, the wizard's picker) and
// lib/booking-slots (the public booking page). Fixing one and forgetting the
// other is precisely how the two class-pricing paths burned the same customer
// twice, so both are asserted here against the same facts.
//
// And the hold must be exactly as gone as a cancelled session once it expires,
// with no sweep involved.
const h = vi.hoisted(() => ({
  holdFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  slotFindMany: vi.fn(),
  blackoutFindMany: vi.fn(),
  clientFindUnique: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingHold: { findMany: h.holdFindMany },
    trainingSession: { findMany: h.sessionFindMany },
    availabilitySlot: { findMany: h.slotFindMany },
    blackoutPeriod: { findMany: h.blackoutFindMany },
    clientProfile: { findUnique: h.clientFindUnique },
  },
}))

import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { fetchBookingSlots } from '@/lib/booking-slots'
import { overlapsBusy } from '@/lib/availability'

const TRAINER = 'tr_1'
const ME = 'cl_me'
const SOMEBODY_ELSE = 'cl_them'
const TZ = 'UTC'

// 2pm UTC on a Friday, an hour long.
const TWO_PM = new Date('2026-08-07T14:00:00.000Z')

const heldRow = () => ({ id: 'hold_1', slotAt: TWO_PM, durationMins: 60, bufferMins: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  h.holdFindMany.mockResolvedValue([])
  h.sessionFindMany.mockResolvedValue([])
  h.blackoutFindMany.mockResolvedValue([])
  // Every weekday, 9am–5pm.
  h.slotFindMany.mockResolvedValue(
    [1, 2, 3, 4, 5].map(d => ({
      id: `slot_${d}`, dayOfWeek: d, date: null,
      startTime: '09:00', endTime: '17:00', cadenceWeeks: 1, firstDate: null,
    })),
  )
  h.clientFindUnique.mockResolvedValue({
    trainerId: TRAINER,
    trainer: { businessName: 'Mersea Mutts', user: { timezone: TZ } },
  })
})

// ─── Engine 1: the wizard's own picker ──────────────────────────────────────
describe('self-book availability', () => {
  it('a live hold makes the hour busy', async () => {
    h.holdFindMany.mockResolvedValueOnce([heldRow()])
    const avail = await getTrainerAvailabilityForClient(ME)
    expect(
      overlapsBusy(avail!.busy, '2026-08-07', 14 * 60, 60, 0),
    ).toBe(true)
  })

  // The point of the whole mechanism: nothing is asked to run for the slot to
  // come back. The read simply stops returning the row.
  it('an expired hold frees the hour again, with no sweep', async () => {
    h.holdFindMany.mockResolvedValueOnce([]) // the query filtered it out itself
    const avail = await getTrainerAvailabilityForClient(ME)
    expect(overlapsBusy(avail!.busy, '2026-08-07', 14 * 60, 60, 0)).toBe(false)
    // …because it asked only for unexpired, unconsumed holds.
    expect(h.holdFindMany.mock.calls[0][0].where.consumedAt).toBeNull()
    expect(h.holdFindMany.mock.calls[0][0].where.expiresAt.gt).toBeInstanceOf(Date)
  })

  // The held slot is NOT a confirmed session. It occupies the picker and
  // nothing else — the sessions query is untouched by it.
  it('a hold is never read as a session', async () => {
    h.holdFindMany.mockResolvedValueOnce([heldRow()])
    await getTrainerAvailabilityForClient(ME)
    expect(h.sessionFindMany.mock.calls[0][0].where).toMatchObject({ trainerId: TRAINER, status: 'UPCOMING' })
    expect(h.sessionFindMany.mock.calls[0][0].where).not.toHaveProperty('OR')
  })

  it('the client’s own hold does not hide their own slot', async () => {
    await getTrainerAvailabilityForClient(ME)
    expect(h.holdFindMany.mock.calls[0][0].where.NOT).toEqual({ clientId: ME })
  })

  it('but somebody else’s does', async () => {
    h.holdFindMany.mockResolvedValueOnce([heldRow()])
    const avail = await getTrainerAvailabilityForClient(SOMEBODY_ELSE)
    // The exclusion is keyed to the ASKER, so this row (held by someone else)
    // comes back and blocks.
    expect(h.holdFindMany.mock.calls[0][0].where.NOT).toEqual({ clientId: SOMEBODY_ELSE })
    expect(overlapsBusy(avail!.busy, '2026-08-07', 14 * 60, 60, 0)).toBe(true)
  })

  // A hold carries the turnaround gap the session will occupy, so a slot can't
  // be offered inside a held booking's clean-up time either.
  it('a hold’s buffer counts, exactly as a session’s does', async () => {
    h.holdFindMany.mockResolvedValueOnce([{ ...heldRow(), bufferMins: 30 }])
    const avail = await getTrainerAvailabilityForClient(ME)
    // 3:15pm starts inside the 15:00–15:30 turnaround.
    expect(overlapsBusy(avail!.busy, '2026-08-07', 15 * 60 + 15, 30, 0)).toBe(true)
    // 3:30pm is clear.
    expect(overlapsBusy(avail!.busy, '2026-08-07', 15 * 60 + 30, 30, 0)).toBe(false)
  })
})

// ─── Engine 2: the public booking page ──────────────────────────────────────
describe('booking-page slots', () => {
  const cfg = {
    tz: TZ, windowDays: 7, slotLengthMins: 60, slotIntervalMins: 60,
    minNoticeHours: 0, slotBufferMins: 0, availability: null,
  }
  const at = (days: { slots: { iso: string }[] }[], iso: string) =>
    days.some(d => d.slots.some(s => s.iso === iso))

  it('a live hold takes the slot off the page', async () => {
    h.holdFindMany.mockResolvedValueOnce([heldRow()])
    const days = await fetchBookingSlots(TRAINER, cfg, new Date('2026-08-05T08:00:00.000Z'))
    expect(at(days, TWO_PM.toISOString())).toBe(false)
    // …and the hours around it are still on offer, so it removed one slot, not
    // the day.
    expect(at(days, '2026-08-07T13:00:00.000Z')).toBe(true)
  })

  it('an expired hold puts it back, with no sweep', async () => {
    h.holdFindMany.mockResolvedValueOnce([])
    const days = await fetchBookingSlots(TRAINER, cfg, new Date('2026-08-05T08:00:00.000Z'))
    expect(at(days, TWO_PM.toISOString())).toBe(true)
  })

  it('reads the same unexpired/unconsumed holds the other engine does', async () => {
    const now = new Date('2026-08-05T08:00:00.000Z')
    await fetchBookingSlots(TRAINER, cfg, now)
    const where = h.holdFindMany.mock.calls[0][0].where
    expect(where.trainerId).toBe(TRAINER)
    expect(where.consumedAt).toBeNull()
    expect(where.expiresAt).toEqual({ gt: now })
  })

  it('a signed-in client’s own hold is excluded from their own picker', async () => {
    await fetchBookingSlots(TRAINER, cfg, new Date('2026-08-05T08:00:00.000Z'), { excludeClientId: ME })
    expect(h.holdFindMany.mock.calls[0][0].where.NOT).toEqual({ clientId: ME })
  })
})
