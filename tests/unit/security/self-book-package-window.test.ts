import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/self-book — a client self-books a 1:1 offering at a chosen time.
//
// Security focus: the offering's BOOKING WINDOW is enforced by the server, not
// by the picker. The client's screen won't offer a time outside the window, but
// a crafted POST doesn't come from the screen — and that is the only case that
// matters here. The times below are all genuinely inside the trainer's working
// hours and genuinely free; the ONLY thing wrong with the rejected ones is that
// this offering is not on sale then.
//
// The real availability + booking-window resolvers run; everything else is
// mocked.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  packageFindFirst: vi.fn(),
  packageFindMany: vi.fn(),
  transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})),
  getTrainerAvailabilityForClient: vi.fn(),
  createBookingAssignment: vi.fn(() => 'asg-1'),
  generateSessionDates: vi.fn(() => [new Date('2030-01-08T09:00:00.000Z')]),
  safeEvaluate: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  enforceRateLimit: vi.fn(() => null),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientProfileFindUnique },
    package: { findFirst: h.packageFindFirst, findMany: h.packageFindMany },
    trainingSession: { findMany: vi.fn(() => []) },
    bookingRequest: { create: vi.fn() },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/client-availability', () => ({ getTrainerAvailabilityForClient: h.getTrainerAvailabilityForClient }))
vi.mock('@/lib/self-book', () => ({
  generateSessionDates: h.generateSessionDates,
  createBookingAssignment: h.createBookingAssignment,
}))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: vi.fn() }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: vi.fn(() => true) }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
// NOT mocked, on purpose: @/lib/availability, @/lib/timezone and
// @/lib/package-booking-window — the guard under test IS those.

import { POST, GET } from '@/app/api/my/self-book/route'

// 2030-01-07 Mon · 08 Tue · 09 Wed · 10 Thu
const TUE = '2030-01-08'
const WED = '2030-01-09'

function req(startDate: string) {
  return new Request('http://x/api/my/self-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId: 'pkg-1', startDate }),
  })
}

/** The offering, with whatever booking-window columns the test needs. */
function offering(window: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1', name: 'Puppy Intro', durationMins: 60, bufferMins: 0, sessionCount: 1,
    weeksBetween: 1, sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null,
    selfBookRequiresApproval: false, clientSelfBook: true, trainerId: 't-1',
    ...window,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', isPreview: false })
  h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1', trainerId: 't-1', dogId: 'd-1' })
  h.enforceRateLimit.mockResolvedValue(null)
  h.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
  h.createBookingAssignment.mockReturnValue('asg-1')
  // The trainer works 09:00–17:00 every weekday, with nothing booked and no
  // days off. Anything refused below is refused by the WINDOW alone.
  h.getTrainerAvailabilityForClient.mockResolvedValue({
    trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
    slots: [1, 2, 3, 4, 5].map(d => ({ id: `s${d}`, dayOfWeek: d, date: null, startTime: '09:00', endTime: '17:00' })),
    blackouts: [],
    busy: [],
  })
})

describe('POST /api/my/self-book — no window (every offering created before this)', () => {
  it('books any in-hours time, exactly as it does today', async () => {
    h.packageFindFirst.mockResolvedValue(offering())
    const res = await POST(req(`${WED}T15:00:00.000Z`))
    expect(res.status).toBe(201)
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/my/self-book — a weekly booking window', () => {
  const WEEKLY = {
    bookingWindowMode: 'WEEKLY_WINDOW',
    bookingWindowDays: [2, 4],          // Tue + Thu
    bookingWindowStart: '09:00',
    bookingWindowEnd: '13:00',
  }

  beforeEach(() => h.packageFindFirst.mockResolvedValue(offering(WEEKLY)))

  it('books a time inside the window', async () => {
    const res = await POST(req(`${TUE}T10:00:00.000Z`))
    expect(res.status).toBe(201)
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
  })

  it('refuses a crafted time on a day the offering is not sold on', async () => {
    // Wednesday 10:00 — the trainer is free, the picker never offered it.
    const res = await POST(req(`${WED}T10:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This one isn't offered at that time")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('refuses a crafted time after the window closes', async () => {
    // Tuesday 15:00 — inside the trainer's hours, outside the offering's.
    const res = await POST(req(`${TUE}T15:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This one isn't offered at that time")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('refuses a start that would OVERRUN the window', async () => {
    // 12:30 + 60 minutes runs to 13:30. The window closes at 13:00.
    const res = await POST(req(`${TUE}T12:30:00.000Z`))
    expect(res.status).toBe(400)
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('a window never overrides the trainer’s own availability', async () => {
    // The window says Tuesday 09:00–13:00; the trainer doesn't start until 11.
    // A window NARROWS — it cannot conjure the 09:00 the trainer isn't free for.
    h.getTrainerAvailabilityForClient.mockResolvedValue({
      trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
      slots: [{ id: 'x', dayOfWeek: 2, date: null, startTime: '11:00', endTime: '15:00' }],
      blackouts: [], busy: [],
    })
    const res = await POST(req(`${TUE}T09:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That time isn't available")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('a blackout still empties a day inside the window', async () => {
    h.getTrainerAvailabilityForClient.mockResolvedValue({
      trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
      slots: [1, 2, 3, 4, 5].map(d => ({ id: `s${d}`, dayOfWeek: d, date: null, startTime: '09:00', endTime: '17:00' })),
      blackouts: [{ startDate: TUE, endDate: TUE }],
      busy: [],
    })
    const res = await POST(req(`${TUE}T10:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That time isn't available")
  })

  it('an existing booking still blocks its hour inside the window', async () => {
    h.getTrainerAvailabilityForClient.mockResolvedValue({
      trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
      slots: [1, 2, 3, 4, 5].map(d => ({ id: `s${d}`, dayOfWeek: d, date: null, startTime: '09:00', endTime: '17:00' })),
      blackouts: [],
      busy: [{ dateStr: TUE, startMin: 10 * 60, endMin: 11 * 60 }],
    })
    const res = await POST(req(`${TUE}T10:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That time's just been taken")
  })
})

describe('POST /api/my/self-book — named exact start times', () => {
  const EXACT = {
    bookingWindowMode: 'EXACT_TIMES',
    bookingWindowTimes: [{ day: 2, time: '09:00' }, { day: 2, time: '10:30' }],
  }

  beforeEach(() => h.packageFindFirst.mockResolvedValue(offering(EXACT)))

  it('books one of the named starts', async () => {
    const res = await POST(req(`${TUE}T10:30:00.000Z`))
    expect(res.status).toBe(201)
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
  })

  it('refuses a start one minute off a named one', async () => {
    const res = await POST(req(`${TUE}T09:01:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This one isn't offered at that time")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('refuses a named time on the wrong weekday', async () => {
    const res = await POST(req(`${WED}T09:00:00.000Z`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This one isn't offered at that time")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })
})

describe('GET /api/my/self-book — the list carries the window', () => {
  it('sends the resolved window so any picker narrows to what POST accepts', async () => {
    h.packageFindMany.mockResolvedValue([
      offering({
        bookingWindowMode: 'EXACT_TIMES',
        bookingWindowTimes: [{ day: 2, time: '09:00' }],
      }),
      offering({ id: 'pkg-2' }),
    ])
    const res = await GET()
    const body = await res.json()
    expect(body[0].bookingWindow).toEqual({
      mode: 'EXACT_TIMES', days: [], startTime: null, endTime: null,
      times: [{ day: 2, time: '09:00' }],
    })
    expect(body[1].bookingWindow.mode).toBe('ANY_TIME')
  })
})
