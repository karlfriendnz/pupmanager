import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/self-book — a client self-books a package at a chosen time.
// Security focus: the server must NEVER trust the client's chosen start time —
// a time outside the trainer's published availability is rejected 400, an
// in-window time books. Availability validation runs the REAL availability +
// timezone helpers; everything else is mocked.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  packageFindFirst: vi.fn(),
  transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})),
  getTrainerAvailabilityForClient: vi.fn(),
  createBookingAssignment: vi.fn(() => 'asg-1'),
  generateSessionDates: vi.fn(() => [new Date('2030-01-07T10:00:00.000Z')]),
  safeEvaluate: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  enforceRateLimit: vi.fn(() => null),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientProfileFindUnique },
    package: { findFirst: h.packageFindFirst },
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
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
// NOTE: @/lib/availability and @/lib/timezone are intentionally NOT mocked —
// the real availability guard is what we're testing.

import { POST } from '@/app/api/my/self-book/route'

const DATE = '2030-01-07'

function req(startDate: string) {
  return new Request('http://x/api/my/self-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageId: 'pkg-1', startDate }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', isPreview: false })
  h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1', trainerId: 't-1', dogId: 'd-1' })
  h.packageFindFirst.mockResolvedValue({
    id: 'pkg-1', name: 'Puppy Intro', durationMins: 60, sessionCount: 1, weeksBetween: 1,
    sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null, selfBookRequiresApproval: false,
    clientSelfBook: true, trainerId: 't-1',
  })
  h.enforceRateLimit.mockResolvedValue(null)
  h.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
  h.createBookingAssignment.mockReturnValue('asg-1')
  // Trainer is open 09:00–17:00 (UTC) on the target date, with an existing
  // booking 14:00–15:00 that a self-book must not collide with.
  h.getTrainerAvailabilityForClient.mockResolvedValue({
    trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
    slots: [{ id: 's1', dayOfWeek: null, date: DATE, startTime: '09:00', endTime: '17:00' }],
    blackouts: [],
    busy: [{ dateStr: DATE, startMin: 14 * 60, endMin: 15 * 60 }],
  })
})

describe('POST /api/my/self-book — availability guard', () => {
  it('books an in-window start time', async () => {
    const res = await POST(req(`${DATE}T10:00:00.000Z`)) // 10:00, ends 11:00 — inside 09:00–17:00
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
  })

  it('rejects a start outside the trainer’s availability with 400', async () => {
    const res = await POST(req(`${DATE}T18:00:00.000Z`)) // 18:00 — after the window closes
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That time isn't available")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('rejects a start that overruns the window end', async () => {
    const res = await POST(req(`${DATE}T16:30:00.000Z`)) // 16:30 + 60 → 17:30 overruns 17:00
    expect(res.status).toBe(400)
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('rejects an in-window start that overlaps an existing booking with 400', async () => {
    const res = await POST(req(`${DATE}T14:00:00.000Z`)) // collides with the 14:00–15:00 session
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That time's just been taken")
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('rejects a start that runs into a booking even if it begins earlier', async () => {
    const res = await POST(req(`${DATE}T13:30:00.000Z`)) // 13:30 + 60 → 14:30 overlaps 14:00–15:00
    expect(res.status).toBe(400)
    expect(h.createBookingAssignment).not.toHaveBeenCalled()
  })

  it('still books a free in-window slot next to a booking', async () => {
    const res = await POST(req(`${DATE}T15:00:00.000Z`)) // 15:00–16:00, right after the booked hour
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
  })
})
