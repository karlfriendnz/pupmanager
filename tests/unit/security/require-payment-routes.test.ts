import { describe, it, expect, vi, beforeEach } from 'vitest'

// The "require payment to book" gate across the three client purchase flows:
// self-book (package), buy (product) and enroll (class). Each must take the
// Stripe-checkout branch vs the book-now/invoice branch based on the RESOLVED
// require-payment flag — and self-book's approval-required packages must stay
// request-first (never charged). The real resolveRequirePayment is exercised.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  createConnectCheckout: vi.fn(),
  isConnectConfigured: vi.fn(() => true),
  createInvoiceForAssignment: vi.fn(),
  // prisma surface
  clientProfileFindUnique: vi.fn(),
  packageFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
  classRunFindFirst: vi.fn(),
  trainerFindUnique: vi.fn(),
  bookingRequestCreate: vi.fn(),
  productRequestFindFirst: vi.fn(),
  productRequestCreate: vi.fn(),
  classEnrollmentFindFirst: vi.fn(),
  classEnrollmentUpdate: vi.fn(),
  trainingSessionFindFirst: vi.fn(),
  transaction: vi.fn(),
  // self-book libs
  safeEvaluate: vi.fn(),
  generateSessionDates: vi.fn(() => [new Date('2099-01-01T10:00:00.000Z')]),
  createBookingAssignment: vi.fn(() => 'assign-1'),
  getTrainerAvailabilityForClient: vi.fn(),
  isTimeWithinAvailability: vi.fn(() => true),
  overlapsBusy: vi.fn(() => false),
  utcToZonedDateAndMinutes: vi.fn(() => ({ dateStr: '2099-01-01', minuteOfDay: 600 })),
  // class-runs libs
  enrollInRun: vi.fn(),
  decideEnrollment: vi.fn(() => 'ENROLLED'),
  effectiveCapacity: vi.fn(() => 10),
  enrolledCount: vi.fn(() => 0),
  dropInPriceCents: vi.fn(() => 1000),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientProfileFindUnique },
    package: { findFirst: h.packageFindFirst },
    product: { findUnique: h.productFindUnique },
    classRun: { findFirst: h.classRunFindFirst },
    trainerProfile: { findUnique: h.trainerFindUnique },
    bookingRequest: { create: h.bookingRequestCreate },
    productRequest: { findFirst: h.productRequestFindFirst, create: h.productRequestCreate },
    classEnrollment: { findFirst: h.classEnrollmentFindFirst, update: h.classEnrollmentUpdate },
    trainingSession: { findFirst: h.trainingSessionFindFirst },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/self-book', () => ({ generateSessionDates: h.generateSessionDates, createBookingAssignment: h.createBookingAssignment }))
vi.mock('@/lib/client-availability', () => ({ getTrainerAvailabilityForClient: h.getTrainerAvailabilityForClient }))
vi.mock('@/lib/availability', () => ({ isTimeWithinAvailability: h.isTimeWithinAvailability, overlapsBusy: h.overlapsBusy }))
vi.mock('@/lib/timezone', () => ({ utcToZonedDateAndMinutes: h.utcToZonedDateAndMinutes }))
vi.mock('@/lib/class-runs', () => {
  class ClassError extends Error { code: string; constructor(code: string, m: string) { super(m); this.code = code } }
  return {
    enrollInRun: h.enrollInRun, ClassError,
    decideEnrollment: h.decideEnrollment, effectiveCapacity: h.effectiveCapacity,
    enrolledCount: h.enrolledCount, dropInPriceCents: h.dropInPriceCents,
  }
})
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))

import { POST as selfBookPOST } from '@/app/api/my/self-book/route'
import { POST as buyPOST } from '@/app/api/my/products/[productId]/buy/route'
import { POST as enrollPOST } from '@/app/api/my/classes/[runId]/enroll/route'

const PAY_ON = {
  acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1',
  payoutCurrency: 'nzd', sandboxBilling: false, defaultRequirePayment: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  h.isConnectConfigured.mockReturnValue(true)
  h.createConnectCheckout.mockResolvedValue({ url: 'https://checkout.stripe/x' })
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({}))
  h.createBookingAssignment.mockReturnValue('assign-1')
  h.getTrainerAvailabilityForClient.mockResolvedValue({ tz: 'Pacific/Auckland', slots: [], blackouts: [], busy: [] })
})

// ─── self-book (package) ─────────────────────────────────────────────────────
describe('POST /api/my/self-book require-payment gate', () => {
  function seed(pkg: Record<string, unknown>, trainer: Record<string, unknown> = PAY_ON) {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp1', isPreview: false })
    h.clientProfileFindUnique.mockResolvedValue({ id: 'cp1', trainerId: 't1', dogId: 'd1' })
    h.packageFindFirst.mockResolvedValue({
      id: 'pkg1', name: 'Puppy', durationMins: 60, sessionType: 'IN_PERSON',
      sessionCount: 3, weeksBetween: 2, priceCents: 5000, specialPriceCents: null,
      selfBookRequiresApproval: false, requirePayment: null, ...pkg,
    })
    h.trainerFindUnique.mockResolvedValue({ ...trainer })
    h.bookingRequestCreate.mockResolvedValue({ id: 'br1' })
  }
  function req() {
    return new Request('http://x/api/my/self-book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'pkg1', startDate: '2099-01-01T10:00:00.000Z' }),
    })
  }

  it('approval-required stays request-first — never charged, never invoiced', async () => {
    seed({ selfBookRequiresApproval: true, requirePayment: true })
    const res = await selfBookPOST(req())
    expect(res.status).toBe(201)
    expect((await res.json()).mode).toBe('requested')
    expect(h.bookingRequestCreate).toHaveBeenCalledTimes(1)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
    expect(h.trainerFindUnique).not.toHaveBeenCalled() // short-circuits before the paid path
  })

  it('require-payment=true → Stripe checkout, no invoice', async () => {
    seed({ requirePayment: true })
    const res = await selfBookPOST(req())
    expect((await res.json()).mode).toBe('payment')
    expect(h.createConnectCheckout).toHaveBeenCalledTimes(1)
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
    expect(h.bookingRequestCreate).not.toHaveBeenCalled()
  })

  it('require-payment=false → instant book + invoice, no checkout', async () => {
    seed({ requirePayment: false })
    const res = await selfBookPOST(req())
    expect((await res.json()).mode).toBe('booked')
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.createBookingAssignment).toHaveBeenCalledTimes(1)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'PACKAGE', clientPackageId: 'assign-1' }),
    )
  })

  it('null item inherits the trainer default (default off → book + invoice)', async () => {
    seed({ requirePayment: null }, { ...PAY_ON, defaultRequirePayment: false })
    const res = await selfBookPOST(req())
    expect((await res.json()).mode).toBe('booked')
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).toHaveBeenCalled()
  })

  it('payments OFF always books + invoices, regardless of require-payment=true', async () => {
    seed({ requirePayment: true }, { ...PAY_ON, connectChargesEnabled: false })
    const res = await selfBookPOST(req())
    expect((await res.json()).mode).toBe('booked')
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).toHaveBeenCalled()
  })
})

// ─── buy (product) ───────────────────────────────────────────────────────────
describe('POST /api/my/products/[productId]/buy require-payment gate', () => {
  function seed(product: Record<string, unknown>, trainer: Record<string, unknown> = PAY_ON) {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp1', isPreview: false })
    h.clientProfileFindUnique.mockResolvedValue({ id: 'cp1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({
      id: 'prod1', trainerId: 't1', active: true, name: 'Long line', kind: 'PHYSICAL',
      priceCents: 3000, requirePayment: null, ...product,
    })
    h.trainerFindUnique.mockResolvedValue({ ...trainer })
    h.productRequestFindFirst.mockResolvedValue(null)
    h.productRequestCreate.mockResolvedValue({ id: 'pr1' })
  }
  const req = () => new Request('http://x/buy', { method: 'POST', headers: {}, body: '{}' })
  const params = { params: Promise.resolve({ productId: 'prod1' }) }

  it('require-payment=true → Stripe checkout, no request/invoice', async () => {
    seed({ requirePayment: true })
    const res = await buyPOST(req(), params)
    expect((await res.json()).url).toBe('https://checkout.stripe/x')
    expect(h.createConnectCheckout).toHaveBeenCalledTimes(1)
    expect(h.productRequestCreate).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })

  it('require-payment=false → book now (request) + invoice, no checkout', async () => {
    seed({ requirePayment: false })
    const res = await buyPOST(req(), params)
    expect((await res.json()).mode).toBe('requested')
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.productRequestCreate).toHaveBeenCalledTimes(1)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'PRODUCT', productId: 'prod1' }),
    )
  })

  it('payments OFF is unchanged — 409, no request/invoice/checkout', async () => {
    seed({ requirePayment: false }, { ...PAY_ON, connectChargesEnabled: false })
    const res = await buyPOST(req(), params)
    expect(res.status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.productRequestCreate).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })
})

// ─── enroll (class) ──────────────────────────────────────────────────────────
describe('POST /api/my/classes/[runId]/enroll require-payment gate', () => {
  function seed(runOver: Record<string, unknown>, trainer: Record<string, unknown> = PAY_ON) {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp1', isPreview: false })
    h.clientProfileFindUnique.mockResolvedValue({ id: 'cp1', trainerId: 't1', dogId: 'd1', dogs: [{ id: 'd1' }] })
    h.classRunFindFirst.mockResolvedValue({
      id: 'run1', trainerId: 't1', status: 'SCHEDULED', name: 'Puppy Class', capacity: null,
      requirePayment: null,
      package: {
        isGroup: true, priceCents: 5000, specialPriceCents: null, allowDropIn: false,
        allowWaitlist: false, capacity: null, sessionCount: 6, dropInPriceCents: null,
      },
      ...runOver,
    })
    h.classEnrollmentFindFirst.mockResolvedValue(null)
    h.trainerFindUnique.mockResolvedValue({ ...trainer })
    h.enrollInRun.mockResolvedValue({ enrollmentId: 'enr1', status: 'ENROLLED' })
    h.classEnrollmentUpdate.mockResolvedValue({})
  }
  const req = () => new Request('http://x/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'FULL' }) })
  const params = { params: Promise.resolve({ runId: 'run1' }) }

  it('require-payment=true → Stripe checkout, no enrolment/invoice', async () => {
    seed({ requirePayment: true })
    const res = await enrollPOST(req(), params)
    expect((await res.json()).mode).toBe('payment')
    expect(h.createConnectCheckout).toHaveBeenCalledTimes(1)
    expect(h.enrollInRun).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })

  it('require-payment=false → enrol now + invoice, no checkout', async () => {
    seed({ requirePayment: false })
    const res = await enrollPOST(req(), params)
    expect((await res.json()).mode).toBe('enrolled')
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.enrollInRun).toHaveBeenCalledTimes(1)
    expect(h.classEnrollmentUpdate).toHaveBeenCalled() // stamps invoicedAt
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'CLASS_ENROLLMENT', classEnrollmentId: 'enr1' }),
    )
  })

  it('payments OFF is unchanged — 409, no enrolment/checkout/invoice', async () => {
    seed({ requirePayment: false }, { ...PAY_ON, connectChargesEnabled: false })
    const res = await enrollPOST(req(), params)
    expect(res.status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.enrollInRun).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })
})
