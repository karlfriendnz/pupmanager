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
  classEnrollmentFindMany: vi.fn(),
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
    // The booking gate reads these. findFirst → null means "this offering has
    // no form in front of it", which is what every fixture in this file means.
    commsFlowStep: { findFirst: vi.fn(async () => null) },
    form: { findUnique: vi.fn(async () => null) },
    bookingFormAnswer: { create: vi.fn(async () => ({ id: 'bfa' })), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    bookingHold: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'hold', expiresAt: new Date(), createdAt: new Date() })), update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    package: { findFirst: h.packageFindFirst },
    // stock: takeStock() reads the product then may decrement. The fixtures
    // below carry stockCount: null (untracked), so it short-circuits.
    product: { findUnique: h.productFindUnique, updateMany: vi.fn(async () => ({ count: 1 })) },
    classRun: { findFirst: h.classRunFindFirst },
    trainerProfile: { findUnique: h.trainerFindUnique },
    bookingRequest: { create: h.bookingRequestCreate },
    productRequest: { findFirst: h.productRequestFindFirst, create: h.productRequestCreate, update: vi.fn(async () => ({ id: 'pr1', quantity: 2 })) },
    // The pay-later branch goes through placeProductOrder, which looks up the
    // receivable before deciding whether to raise one or re-price it.
    invoice: { findFirst: vi.fn(async () => null) },
    invoiceLineItem: { update: vi.fn(async () => ({})) },
    // findMany: the pay-later path now quotes the offering's discounts across
    // the whole basket before invoicing it, so it re-reads the rows it booked.
    classEnrollment: {
      findFirst: h.classEnrollmentFindFirst,
      update: h.classEnrollmentUpdate,
      findMany: h.classEnrollmentFindMany,
    },
    trainingSession: { findFirst: h.trainingSessionFindFirst },
    // The enrol route quotes discounts (none configured here → no change to the amounts).
    discount: { findMany: vi.fn(() => []) },
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
    // The enrol route reads these AT MODULE SCOPE to build its zod schema
    // (`.max(MAX_TICKET_QUANTITY)`), so a factory mock that omits them makes
    // the constant undefined and zod throws while the module is still being
    // imported — the whole test file dies before a single test runs. Keep the
    // constant in step with src/lib/class-runs.ts.
    MAX_TICKET_QUANTITY: 20,
    normalizeTicketQuantity: (v: unknown) => {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1
      return Math.max(1, Math.min(n, 20))
    },
    sessionAttendeeCount: () => 0,
    sessionDropInPriceCents: () => null,
    sessionCapacity: () => null,
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
    h.productFindUnique.mockResolvedValue({ stockCount: null,
      id: 'prod1', trainerId: 't1', active: true, name: 'Long line', kind: 'PHYSICAL',
      priceCents: 3000, requirePayment: null, ...product,
    })
    h.trainerFindUnique.mockResolvedValue({ ...trainer })
    h.productRequestFindFirst.mockResolvedValue(null)
    h.productRequestCreate.mockResolvedValue({ id: 'pr1', quantity: 1 })
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
        // The route includes ticketTiers and branches on its length — an
        // ordinary class sells no tickets, so an empty list is the shape a
        // non-ticketed offering really has.
        ticketTiers: [],
      },
      ...runOver,
    })
    h.classEnrollmentFindFirst.mockResolvedValue(null)
    h.trainerFindUnique.mockResolvedValue({ ...trainer })
    h.enrollInRun.mockResolvedValue({ enrollmentId: 'enr1', status: 'ENROLLED' })
    h.classEnrollmentUpdate.mockResolvedValue({})
    // No discounts to quote here — this suite is about the payment gate.
    h.classEnrollmentFindMany.mockResolvedValue([])
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

  // ── Ticketed events ────────────────────────────────────────────────────────
  // The bug these pin: a ticketed event was quoted and charged at the PACKAGE
  // price, so a client self-booking a $200 ticket paid $45. The package price on
  // a ticketed offering is meaningless — the tier row is the only price.
  const TIERS = [
    { id: 'tier-vip', name: 'VIP', priceCents: 20000, capacity: null, order: 0 },
    { id: 'tier-std', name: 'Standard', priceCents: 8900, capacity: null, order: 1 },
  ]
  const ticketReq = (body: Record<string, unknown>) =>
    new Request('http://x/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'FULL', ...body }) })

  it('a ticketed event charges the TICKET price, never the package price', async () => {
    seed({ requirePayment: true, package: { isGroup: true, priceCents: 4500, specialPriceCents: null, allowDropIn: false, allowWaitlist: false, capacity: null, sessionCount: 1, dropInPriceCents: null, ticketTiers: TIERS } })
    const res = await enrollPOST(ticketReq({ ticketTierId: 'tier-vip', quantity: 2 }), params)
    expect(res.status).toBe(201)
    const arg = h.createConnectCheckout.mock.calls[0][0]
    const charged = arg.lines.reduce((sum: number, l: { unitAmount: number; quantity: number }) => sum + l.unitAmount * l.quantity, 0)
    // 2 × $200.00 — emphatically not the package's $45.
    expect(charged).toBe(40000)
    expect(charged).not.toBe(4500)
  })

  it('a ticketed event refuses a booking with no ticket chosen', async () => {
    seed({ requirePayment: true, package: { isGroup: true, priceCents: 4500, specialPriceCents: null, allowDropIn: false, allowWaitlist: false, capacity: null, sessionCount: 1, dropInPriceCents: null, ticketTiers: TIERS } })
    const res = await enrollPOST(req(), params)
    expect(res.status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
    expect(h.enrollInRun).not.toHaveBeenCalled()
  })

  it("a tier id that isn't on this event is refused, not silently priced", async () => {
    seed({ requirePayment: true, package: { isGroup: true, priceCents: 4500, specialPriceCents: null, allowDropIn: false, allowWaitlist: false, capacity: null, sessionCount: 1, dropInPriceCents: null, ticketTiers: TIERS } })
    const res = await enrollPOST(ticketReq({ ticketTierId: 'tier-from-another-event', quantity: 1 }), params)
    expect(res.status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('the pay-later path records the tier and quantity on the enrolment', async () => {
    // Without these the receivable is raised from an enrolment with no tier,
    // and createInvoiceForAssignment falls straight back to the package price.
    seed({ requirePayment: false, package: { isGroup: true, priceCents: 4500, specialPriceCents: null, allowDropIn: false, allowWaitlist: false, capacity: null, sessionCount: 1, dropInPriceCents: null, ticketTiers: TIERS } })
    const res = await enrollPOST(ticketReq({ ticketTierId: 'tier-std', quantity: 3 }), params)
    expect(res.status).toBe(201)
    expect(h.enrollInRun).toHaveBeenCalledTimes(1)
    expect(h.enrollInRun).toHaveBeenCalledWith(
      expect.objectContaining({ ticketTierId: 'tier-std', quantity: 3, type: 'FULL' }),
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
