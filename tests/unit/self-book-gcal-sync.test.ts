import { describe, it, expect, vi, beforeEach } from 'vitest'

// The client self-book route must mirror an instant (free / book-now) booking to
// the trainer's Google Calendar. createBookingAssignment uses createMany (no
// ids), so the route re-reads the created rows by the assignment id and syncs
// exactly those. Best-effort — a Google failure never breaks the booking.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  packageFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})),
  getTrainerAvailabilityForClient: vi.fn(),
  createBookingAssignment: vi.fn(() => 'asg-1'),
  generateSessionDates: vi.fn(() => [new Date('2030-01-07T10:00:00.000Z')]),
  safeEvaluate: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  enforceRateLimit: vi.fn(() => null),
  notifyTrainer: vi.fn(),
  syncSessionsToGoogle: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientProfileFindUnique },
    package: { findFirst: h.packageFindFirst },
    trainingSession: { findMany: h.sessionFindMany },
    bookingRequest: { create: vi.fn().mockResolvedValue({ id: 'br-1' }) },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/client-availability', () => ({ getTrainerAvailabilityForClient: h.getTrainerAvailabilityForClient }))
vi.mock('@/lib/self-book', () => ({ generateSessionDates: h.generateSessionDates, createBookingAssignment: h.createBookingAssignment }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: vi.fn() }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: vi.fn(() => true) }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('@/lib/google-calendar-sync', () => ({ syncSessionsToGoogle: h.syncSessionsToGoogle }))
// Real availability + timezone helpers (the guard is genuine).

import { POST } from '@/app/api/my/self-book/route'

const DATE = '2030-01-07'
function req(startDate: string) {
  return new Request('http://x/api/my/self-book', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  h.syncSessionsToGoogle.mockResolvedValue(undefined)
  h.getTrainerAvailabilityForClient.mockResolvedValue({
    trainerId: 't-1', businessName: 'Biz', tz: 'UTC',
    slots: [{ id: 's1', dayOfWeek: null, date: DATE, startTime: '09:00', endTime: '17:00' }],
    blackouts: [], busy: [],
  })
})

describe('POST /api/my/self-book — Google Calendar sync', () => {
  it('mirrors the instant-booked sessions (re-read by the new assignment id)', async () => {
    h.sessionFindMany.mockResolvedValue([{ id: 'sb-1' }])
    const res = await POST(req(`${DATE}T10:00:00.000Z`))
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
    expect(h.sessionFindMany).toHaveBeenCalledWith({ where: { clientPackageId: 'asg-1' }, select: { id: true } })
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['sb-1'])
  })

  it('a Google failure never breaks the booking (still 201 booked)', async () => {
    h.sessionFindMany.mockResolvedValue([{ id: 'sb-1' }])
    h.syncSessionsToGoogle.mockRejectedValue(new Error('Google down'))
    const res = await POST(req(`${DATE}T10:00:00.000Z`))
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
  })

  it('does NOT sync when the booking was request-first (approval required)', async () => {
    h.packageFindFirst.mockResolvedValue({
      id: 'pkg-1', name: 'Puppy Intro', durationMins: 60, sessionCount: 1, weeksBetween: 1,
      sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null, selfBookRequiresApproval: true,
      clientSelfBook: true, trainerId: 't-1',
    })
    const res = await POST(req(`${DATE}T10:00:00.000Z`))
    expect((await res.json()).mode).toBe('requested')
    expect(h.syncSessionsToGoogle).not.toHaveBeenCalled()
  })
})
