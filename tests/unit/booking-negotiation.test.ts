import { describe, it, expect, vi, beforeEach } from 'vitest'

// Negotiating a booking time, end to end.
//
// The feature is a VOLLEY — trainer suggests, client counters, trainer counters
// again, somebody approves — so the tests are a volley too. Testing one
// proposal in isolation would miss the only thing that is actually hard here:
// what happens to the offers that came before the live one.
//
// The four refusals, all server-side and all deliberate:
//
//   1. a SUPERSEDED proposal cannot be approved. The card is still on screen
//      three messages up the thread, so "we hid the button" is not an answer;
//   2. nobody approves their OWN suggestion;
//   3. a time that has been booked since the offer was made is refused rather
//      than double-booked;
//   4. a request already confirmed or declined takes no more offers.

const h = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  reqFindFirst: vi.fn(),
  reqFindUnique: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalFindFirst: vi.fn(),
  proposalUpdateMany: vi.fn(),
  proposalUpdate: vi.fn(),
  proposalCreate: vi.fn(),
  messageCreate: vi.fn(),
  transaction: vi.fn(),
  availability: vi.fn(),
  confirm: vi.fn(),
  notify: vi.fn(),
}))

// next/server's `after()` throws outside a request scope. Collect the callbacks
// instead of dropping them, so the notification assertions test the real thing
// rather than an empty promise.
const deferred: (() => unknown)[] = []
vi.mock('next/server', async (orig) => ({
  ...(await orig() as object),
  after: (fn: () => unknown) => { deferred.push(fn) },
}))
async function flushAfter() {
  const queued = deferred.splice(0)
  for (const fn of queued) await fn()
}
vi.mock('@/lib/booking-negotiation-actor', () => ({ resolveNegotiationActor: h.resolveActor }))
vi.mock('@/lib/client-availability', () => ({
  getTrainerAvailabilityById: h.availability,
  getTrainerAvailabilityForClient: vi.fn(),
}))
vi.mock('@/lib/booking-request-confirm', () => ({ confirmBookingRequest: h.confirm }))
vi.mock('@/lib/notify-message-recipient', () => ({ notifyMessageRecipient: h.notify }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingRequest: { findFirst: h.reqFindFirst, findUnique: h.reqFindUnique },
    bookingProposal: {
      findUnique: h.proposalFindUnique,
      findFirst: h.proposalFindFirst,
      updateMany: h.proposalUpdateMany,
      update: h.proposalUpdate,
      create: h.proposalCreate,
    },
    message: { create: h.messageCreate },
    $transaction: h.transaction,
  },
}))

import { POST as propose } from '@/app/api/booking-requests/[id]/propose/route'
import { POST as approve } from '@/app/api/booking-proposals/[id]/approve/route'

const TRAINER = 'trainer_1'
const CLIENT = 'client_1'

// Far enough ahead that "in the future" is never flaky.
function future(daysAhead: number, hour = 10): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(hour, 0, 0, 0)
  return d
}

/** A three-session weekly package — the multi-session case is the default here
 *  on purpose, because a counter-offer moving the whole series is the design
 *  decision most likely to be broken by a later change. */
const PKG = {
  name: 'Puppy Basics',
  sessionCount: 3,
  weeksBetween: 1,
  durationMins: 60,
  bufferMins: 0,
  bookingWindowMode: 'ANY_TIME',
  bookingWindowRanges: [],
  bookingWindowDates: [],
  bookingWindowTimes: [],
  bookingWindowDays: [],
  bookingWindowStart: null,
  bookingWindowEnd: null,
}

function pendingRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req_1',
    trainerId: TRAINER,
    clientId: CLIENT,
    status: 'PENDING',
    package: PKG,
    ...over,
  }
}

/** The trainer is free all week, with nothing in the diary, unless a test says
 *  otherwise. Same shape getTrainerAvailabilityById really returns. */
function freeDiary(busy: { dateStr: string; startMin: number; endMin: number }[] = []) {
  return {
    trainerId: TRAINER,
    businessName: 'Test',
    tz: 'Pacific/Auckland',
    slots: [1, 2, 3, 4, 5, 6, 7].map(d => ({
      id: `a${d}`, dayOfWeek: d, date: null,
      startTime: '00:00', endTime: '23:59', cadenceWeeks: 1, firstDate: null,
    })),
    blackouts: [],
    busy,
  }
}

const actor = (party: 'TRAINER' | 'CLIENT') => ({
  ok: true,
  actor: { party, userId: party === 'TRAINER' ? 'u_trainer' : 'u_client', isPreview: false },
})

const proposeReq = (startIso: string, message?: string) =>
  propose(
    new Request('http://localhost/api/booking-requests/req_1/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startIso, message }),
    }),
    { params: Promise.resolve({ id: 'req_1' }) },
  )

const approveReq = (id: string) =>
  approve(new Request(`http://localhost/api/booking-proposals/${id}/approve`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  deferred.length = 0
  h.reqFindFirst.mockResolvedValue(pendingRequest())
  h.reqFindUnique.mockResolvedValue({ package: PKG })
  h.availability.mockResolvedValue(freeDiary())
  h.proposalUpdateMany.mockResolvedValue({ count: 0 })
  h.proposalUpdate.mockResolvedValue({})
  h.messageCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `msg_${h.messageCreate.mock.calls.length}`, ...data }),
  )
  h.proposalCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `prop_${h.proposalCreate.mock.calls.length}`, ...data }),
  )
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      bookingProposal: {
        updateMany: h.proposalUpdateMany,
        create: h.proposalCreate,
        update: h.proposalUpdate,
      },
      message: { create: h.messageCreate },
    }),
  )
  h.confirm.mockResolvedValue({ ok: true, clientPackageId: 'cp_1' })
  h.notify.mockResolvedValue(undefined)
})

// ─── The volley ─────────────────────────────────────────────────────────────

describe('a time is negotiated back and forth until somebody says yes', () => {
  it('lets each side counter the other, any number of rounds, then books', async () => {
    // Round 1 — the trainer says "not that hour".
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    const r1 = await proposeReq(future(7).toISOString(), 'Tuesday is packed, how about Wednesday?')
    expect(r1.status).toBe(201)

    // Round 2 — the client counters.
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    const r2 = await proposeReq(future(8).toISOString())
    expect(r2.status).toBe(201)

    // Round 3 — the trainer counters again.
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    const r3 = await proposeReq(future(9).toISOString())
    expect(r3.status).toBe(201)
    const third = await r3.json()

    // Every round superseded whatever was open before it — that is what makes
    // "only the newest is live" true rather than merely displayed.
    expect(h.proposalUpdateMany).toHaveBeenCalledTimes(3)
    for (const call of h.proposalUpdateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ requestId: 'req_1', status: 'OPEN' })
      expect(call[0].data).toMatchObject({ status: 'SUPERSEDED' })
    }

    // Round 4 — the client approves the trainer's latest, and it books.
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: third.proposalId,
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: third.sessionDates,
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: third.proposalId })

    const ok = await approveReq(third.proposalId)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, status: 'CONFIRMED', clientPackageId: 'cp_1' })
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req_1', trainerId: TRAINER }),
    )
  })

  it('moves the WHOLE series, re-derived on the package cadence', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    const start = future(7, 14)
    const res = await proposeReq(start.toISOString())
    const body = await res.json()

    // Three sessions, a week apart, from the proposed start — the same shape
    // generateSessionDates gives a straight request, so a negotiated booking is
    // indistinguishable from a first-time-lucky one downstream.
    expect(body.sessionDates).toHaveLength(3)
    const dates = body.sessionDates.map((d: string) => new Date(d))
    expect(dates[0].toISOString()).toBe(start.toISOString())
    expect(dates[1].getTime() - dates[0].getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(dates[2].getTime() - dates[1].getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('carries the proposal into the message thread, with the note the sender wrote', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    await proposeReq(future(7).toISOString(), 'Wednesday works better for me')

    const message = h.messageCreate.mock.calls[0][0].data
    expect(message).toMatchObject({ clientId: CLIENT, channel: 'TRAINER_CLIENT', senderId: 'u_trainer' })
    expect(message.body).toContain('Wednesday works better for me')
    // The body says it in words as well as in the card, so a push preview or an
    // email digest still reads as a sentence.
    expect(message.body).toContain('Puppy Basics')

    // The proposal is tied to that message, not floating beside it.
    expect(h.proposalCreate.mock.calls[0][0].data).toMatchObject({
      requestId: 'req_1',
      proposedBy: 'TRAINER',
      messageId: message.id ?? 'msg_1',
    })
  })

  it('falls back to the default note when the sender clears it', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    await proposeReq(future(7).toISOString(), '   ')
    // PLACEHOLDER copy — Karl signs the wording off; what is asserted is that
    // an empty note never sends an empty message.
    expect(h.messageCreate.mock.calls[0][0].data.body.trim().length).toBeGreaterThan(20)
  })

  it('notifies the other party through the existing message notifier, not a second one', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    await proposeReq(future(7).toISOString(), 'Wednesday?')
    await flushAfter()

    // ONE notification, and it is the message notifier — which routes to push,
    // email and the in-app feed already gated by the recipient's own
    // NEW_MESSAGE / CLIENT_NEW_MESSAGE preference. A second "a time was
    // proposed" notifier would tell someone twice about one event and would
    // have to re-learn their preferences to do it.
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT, senderId: 'u_trainer' }),
    )
  })

  it('records the outcome in the thread when a proposal is approved', async () => {
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_1',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [future(7).toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: 'prop_1' })

    await approveReq('prop_1')
    await flushAfter()

    // The conversation ends on an answer rather than an unanswered question,
    // and the accepted offer is stamped so nothing can approve it twice.
    expect(h.proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    )
    expect(h.messageCreate).toHaveBeenCalledTimes(1)
    expect(h.messageCreate.mock.calls[0][0].data.body).toMatch(/booked in for/i)
    expect(h.notify).toHaveBeenCalledTimes(1)
  })
})

// ─── Only the newest offer is live ──────────────────────────────────────────

describe('a superseded proposal is refused by the server, not just hidden', () => {
  it('refuses one already stamped SUPERSEDED', async () => {
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_old',
      requestId: 'req_1',
      status: 'SUPERSEDED',
      proposedBy: 'TRAINER',
      sessionDates: [future(7).toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })

    const res = await approveReq('prop_old')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/newer time/i)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses one that is still OPEN but no longer the newest', async () => {
    // The belt to the stamp's braces: a partial write or a hand-edited row
    // leaves an OPEN proposal with something newer after it. Ordering catches
    // what the column missed, and nothing books.
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_old',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [future(7).toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: 'prop_newer' })

    const res = await approveReq('prop_old')
    expect(res.status).toBe(409)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses the proposer approving their own suggestion', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_1',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [future(7).toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: 'prop_1' })

    const res = await approveReq('prop_1')
    expect(res.status).toBe(403)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses when the request itself has already been decided', async () => {
    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_1',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [future(7).toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'CONFIRMED' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: 'prop_1' })

    const res = await approveReq('prop_1')
    expect(res.status).toBe(409)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('takes no new offer on a request that has already been decided', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    h.reqFindFirst.mockResolvedValue(null) // the PENDING filter found nothing
    const res = await proposeReq(future(7).toISOString())
    expect(res.status).toBe(409)
    expect(h.proposalCreate).not.toHaveBeenCalled()
  })
})

// ─── The diary fills up while you are haggling ──────────────────────────────

describe('an approval never double-books', () => {
  it('refuses when the slot has been taken since the offer was made', async () => {
    const when = future(7, 10)
    const y = when.getFullYear()
    const m = String(when.getMonth() + 1).padStart(2, '0')
    const d = String(when.getDate()).padStart(2, '0')
    // Block the whole day in the trainer's timezone so the test never depends
    // on the machine's own offset.
    h.availability.mockResolvedValue(
      freeDiary([{ dateStr: `${y}-${m}-${d}`, startMin: 0, endMin: 24 * 60 }]),
    )

    h.resolveActor.mockResolvedValue(actor('CLIENT'))
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_1',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [when.toISOString()],
      createdAt: new Date(),
      request: { trainerId: TRAINER, clientId: CLIENT, status: 'PENDING' },
    })
    h.proposalFindFirst.mockResolvedValue({ id: 'prop_1' })

    const res = await approveReq('prop_1')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.reason).toBe('taken')
    // The message has to be useful, not just a refusal — the next move is to
    // suggest another time, so it says so.
    expect(body.error).toMatch(/suggest another/i)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses to OFFER a time the trainer is already booked for', async () => {
    const when = future(7, 10)
    const y = when.getFullYear()
    const m = String(when.getMonth() + 1).padStart(2, '0')
    const d = String(when.getDate()).padStart(2, '0')
    h.availability.mockResolvedValue(
      freeDiary([{ dateStr: `${y}-${m}-${d}`, startMin: 0, endMin: 24 * 60 }]),
    )

    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    const res = await proposeReq(when.toISOString())
    expect(res.status).toBe(400)
    expect(h.proposalCreate).not.toHaveBeenCalled()
  })

  it('refuses a time in the past from either side', async () => {
    h.resolveActor.mockResolvedValue(actor('TRAINER'))
    const res = await proposeReq(new Date(Date.now() - 60_000).toISOString())
    expect(res.status).toBe(400)
    expect(h.proposalCreate).not.toHaveBeenCalled()
  })
})
