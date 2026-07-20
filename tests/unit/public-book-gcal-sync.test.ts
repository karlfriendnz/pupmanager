import { describe, it, expect, vi, beforeEach } from 'vitest'

// The public booking-page route (an existing client booking themselves) must
// mirror the booked session(s) to the trainer's Google Calendar. It passes the
// ids materializeBooking returns straight to the sync engine. Best-effort.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => '1.2.3.4'),
  isSlotAvailable: vi.fn(() => true),
  fetchBookingSlots: vi.fn(),
  bookingConfig: vi.fn(() => ({})),
  materializeBooking: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  generateSessionDates: vi.fn(() => [new Date('2030-01-07T10:00:00.000Z')]),
  safeEvaluate: vi.fn(),
  notifyEnquiryTrainer: vi.fn(),
  runOnBookingAutomations: vi.fn(),
  syncSessionsToGoogle: vi.fn(),
  // prisma surface
  trainerFindUnique: vi.fn(),
  clientFindFirst: vi.fn(),
  transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/booking-slots', () => ({ isSlotAvailable: h.isSlotAvailable, fetchBookingSlots: h.fetchBookingSlots }))
vi.mock('@/lib/booking-page', () => ({ bookingConfig: h.bookingConfig, materializeBooking: h.materializeBooking }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/self-book', () => ({ generateSessionDates: h.generateSessionDates }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/notify-enquiry-trainer', () => ({ notifyEnquiryTrainer: h.notifyEnquiryTrainer }))
vi.mock('@/lib/booking-automations', () => ({ runOnBookingAutomations: h.runOnBookingAutomations }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: vi.fn() }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: vi.fn(() => true) }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('@/lib/google-calendar-sync', () => ({ syncSessionsToGoogle: h.syncSessionsToGoogle }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findFirst: h.clientFindFirst },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/c/[slug]/book/[pageSlug]/route'

function req() {
  return POST(
    new Request('https://app.pupmanager.com/c/biz/book/intro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotIso: '2030-01-07T10:00:00.000Z' }),
    }),
    { params: Promise.resolve({ slug: 'biz', pageSlug: 'intro' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  h.isSlotAvailable.mockResolvedValue(true)
  h.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
  h.syncSessionsToGoogle.mockResolvedValue(undefined)
  // Enabled page, no package (single session), no approval / no payment.
  h.trainerFindUnique.mockResolvedValue({
    id: 't-1', businessName: 'Biz', user: { timezone: 'Pacific/Auckland' },
    acceptPaymentsEnabled: false, connectChargesEnabled: false, connectAccountId: null,
    payoutCurrency: 'nzd', sandboxBilling: false,
    bookingPages: [{
      id: 'page-1', slug: 'intro', enabled: true, packageId: null, requiresApproval: false,
      requiresPayment: false, slotLengthMins: 60, sessionType: 'IN_PERSON', headline: 'Intro', name: 'Intro', priceCents: null,
    }],
  })
  // Logged-in existing client of this trainer.
  h.auth.mockResolvedValue({ user: { id: 'u-1' } })
  h.clientFindFirst.mockResolvedValue({ id: 'cp-1', dogId: 'd-1', user: { name: 'Sam', email: 's@x.com' }, dog: { name: 'Bailey' } })
})

describe('POST /c/[slug]/book/[pageSlug] — Google Calendar sync', () => {
  it('mirrors the session ids materializeBooking returns', async () => {
    h.materializeBooking.mockResolvedValue({ clientPackageId: null, sessionIds: ['pb-1'] })
    const res = await req()
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['pb-1'])
  })

  it('a Google failure never breaks the booking (still 201 booked)', async () => {
    h.materializeBooking.mockResolvedValue({ clientPackageId: null, sessionIds: ['pb-1'] })
    h.syncSessionsToGoogle.mockRejectedValue(new Error('Google down'))
    const res = await req()
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('booked')
  })
})
