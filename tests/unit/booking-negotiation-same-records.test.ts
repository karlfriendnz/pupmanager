import { describe, it, expect, vi, beforeEach } from 'vitest'

// AGENTS.md #4, applied forwards instead of backwards.
//
// The rule was written about UNDOING — "count what the action did and make the
// undo do the same number of things" — after cancelling a product order deleted
// the request and left the invoice standing. The same counting is what proves
// this feature, from the other end: a booking arrived at after four rounds of
// haggling must produce the SAME records as one confirmed first time. Not
// similar. The same, and the same number of them.
//
// A trainer whose negotiated bookings quietly skipped the receivable would find
// out at the end of the month, from their bank balance.
//
// So this test does not check that both paths "work". It calls the shared
// confirm both ways — the request's own dates, and an accepted counter-offer's
// dates — and asserts every downstream effect fires the same number of times
// with the same arguments, with exactly one difference: WHEN the sessions are.

const h = vi.hoisted(() => ({
  reqFindFirst: vi.fn(),
  reqUpdate: vi.fn(),
  sessionFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  transaction: vi.fn(),
  createAssignment: vi.fn(),
  createInvoice: vi.fn(),
  safeEvaluate: vi.fn(),
  syncToGoogle: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingRequest: { findFirst: h.reqFindFirst, update: h.reqUpdate },
    trainingSession: { findMany: h.sessionFindMany },
    clientNotification: { create: h.notificationCreate },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/self-book', () => ({ createBookingAssignment: h.createAssignment }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoice }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/google-calendar-sync', () => ({ syncSessionsToGoogle: h.syncToGoogle }))

import { confirmBookingRequest } from '@/lib/booking-request-confirm'

const TRAINER = 'trainer_1'
const ASKED = [
  new Date('2026-09-01T21:00:00.000Z'),
  new Date('2026-09-08T21:00:00.000Z'),
  new Date('2026-09-15T21:00:00.000Z'),
]
const AGREED = [
  new Date('2026-09-03T02:00:00.000Z'),
  new Date('2026-09-10T02:00:00.000Z'),
  new Date('2026-09-17T02:00:00.000Z'),
]

beforeEach(() => {
  vi.clearAllMocks()
  h.reqFindFirst.mockResolvedValue({
    id: 'req_1',
    trainerId: TRAINER,
    clientId: 'client_1',
    packageId: 'pkg_1',
    dogId: 'dog_1',
    bookingPageId: null,
    sessionDates: ASKED.map(d => d.toISOString()),
    package: {
      name: 'Puppy Basics', sessionCount: 3, durationMins: 60,
      bufferMins: 0, sessionType: 'IN_PERSON',
    },
  })
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({ bookingRequest: { update: h.reqUpdate } }),
  )
  h.createAssignment.mockResolvedValue('cp_1')
  h.sessionFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
  h.reqUpdate.mockResolvedValue({})
  h.notificationCreate.mockResolvedValue({})
  h.createInvoice.mockResolvedValue(undefined)
  h.safeEvaluate.mockResolvedValue(undefined)
  h.syncToGoogle.mockResolvedValue(undefined)
})

/** Everything one confirmation did, as a countable shape. */
function tally() {
  return {
    assignments: h.createAssignment.mock.calls.length,
    requestUpdates: h.reqUpdate.mock.calls.length,
    invoices: h.createInvoice.mock.calls.length,
    notifications: h.notificationCreate.mock.calls.length,
    achievementEvals: h.safeEvaluate.mock.calls.length,
    calendarSyncs: h.syncToGoogle.mock.calls.length,
  }
}

describe('a negotiated booking produces the same records as a straight one', () => {
  it('does the same number of things, of the same kinds', async () => {
    const straight = await confirmBookingRequest({ requestId: 'req_1', trainerId: TRAINER })
    expect(straight).toEqual({ ok: true, clientPackageId: 'cp_1' })
    const straightTally = tally()
    const straightAssignment = h.createAssignment.mock.calls[0][1]
    const straightInvoice = h.createInvoice.mock.calls[0][0]

    vi.clearAllMocks()
    // Re-arm — clearAllMocks drops the implementations too.
    h.reqFindFirst.mockResolvedValue({
      id: 'req_1', trainerId: TRAINER, clientId: 'client_1', packageId: 'pkg_1',
      dogId: 'dog_1', bookingPageId: null,
      sessionDates: ASKED.map(d => d.toISOString()),
      package: {
        name: 'Puppy Basics', sessionCount: 3, durationMins: 60,
        bufferMins: 0, sessionType: 'IN_PERSON',
      },
    })
    h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({ bookingRequest: { update: h.reqUpdate } }),
    )
    h.createAssignment.mockResolvedValue('cp_1')
    h.sessionFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }])

    const negotiated = await confirmBookingRequest({
      requestId: 'req_1',
      trainerId: TRAINER,
      sessionDates: AGREED,
    })
    expect(negotiated).toEqual({ ok: true, clientPackageId: 'cp_1' })

    // The counting. One assignment, one request update, one receivable, one
    // client notification, one achievement pass, one calendar mirror — both
    // times, because it is the same function.
    expect(tally()).toEqual(straightTally)
    expect(straightTally).toEqual({
      assignments: 1, requestUpdates: 1, invoices: 1,
      notifications: 1, achievementEvals: 1, calendarSyncs: 1,
    })

    // Same arguments too, but for the one thing a negotiation is allowed to
    // change.
    const negotiatedAssignment = h.createAssignment.mock.calls[0][1]
    expect({ ...negotiatedAssignment, sessionDates: undefined })
      .toEqual({ ...straightAssignment, sessionDates: undefined })
    expect(negotiatedAssignment.sessionDates).toEqual(AGREED)
    expect(straightAssignment.sessionDates).toEqual(ASKED)
    expect(h.createInvoice.mock.calls[0][0]).toEqual(straightInvoice)
  })

  it('records the times that were AGREED on the request, not the ones first asked for', async () => {
    // Otherwise the row says the client is booked for Tuesday while the diary
    // says Thursday, and the next person to read it believes the row.
    await confirmBookingRequest({ requestId: 'req_1', trainerId: TRAINER, sessionDates: AGREED })
    expect(h.reqUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'CONFIRMED',
      resultingClientPackageId: 'cp_1',
      sessionDates: AGREED.map(d => d.toISOString()),
    })
  })

  it('books nothing for a request that is no longer PENDING', async () => {
    // The status filter is the idempotency: approving twice must not produce a
    // second series of sessions and a second invoice.
    h.reqFindFirst.mockResolvedValue(null)
    const res = await confirmBookingRequest({ requestId: 'req_1', trainerId: TRAINER, sessionDates: AGREED })
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
    expect(tally()).toEqual({
      assignments: 0, requestUpdates: 0, invoices: 0,
      notifications: 0, achievementEvals: 0, calendarSyncs: 0,
    })
  })

  it('books nothing when the agreed series is empty', async () => {
    h.reqFindFirst.mockResolvedValue({
      id: 'req_1', trainerId: TRAINER, clientId: 'client_1', packageId: 'pkg_1',
      dogId: null, bookingPageId: null, sessionDates: [],
      package: {
        name: 'Puppy Basics', sessionCount: 3, durationMins: 60,
        bufferMins: 0, sessionType: 'IN_PERSON',
      },
    })
    const res = await confirmBookingRequest({ requestId: 'req_1', trainerId: TRAINER })
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(h.createAssignment).not.toHaveBeenCalled()
  })
})
