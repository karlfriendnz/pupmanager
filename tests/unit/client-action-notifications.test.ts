import { describe, it, expect, vi, beforeEach } from 'vitest'

// A trainer gets a live notification for EVERY client action. These tests pin
// that each wired client-authenticated route calls notifyTrainer with the
// right new type + detail + deep link, resolving the trainer as
// assignedTrainer → business owner (same shape as the training-log route), and
// that a trainer-in-preview / a trainer actor does NOT self-notify.
//
// Covered: self-book (CLIENT_BOOKED_SESSION), class enrol (CLIENT_BOOKED_SESSION),
// shop request + buy (CLIENT_SHOP_ORDER). Cancel: there is currently NO
// client-facing cancellation route — every cancel/withdraw path is trainer-only
// — so the negative test pins that a trainer withdrawing an enrolment does not
// fire a client-action notification.

const h = vi.hoisted(() => ({
  ClassError: class ClassError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
  getActiveClient: vi.fn(),
  auth: vi.fn(),
  guardPermission: vi.fn(),
  notifyTrainer: vi.fn(),
  // prisma
  clientProfileFindUnique: vi.fn(),
  packageFindFirst: vi.fn(),
  bookingRequestCreate: vi.fn(),
  classRunFindFirst: vi.fn(),
  classEnrollmentFindFirst: vi.fn(),
  classEnrollmentFindUnique: vi.fn(),
  classEnrollmentUpdate: vi.fn(),
  trainingSessionFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
  productRequestFindFirst: vi.fn(),
  productRequestCreate: vi.fn(),
  productRequestDeleteMany: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  txn: vi.fn(),
  // libs
  enforceRateLimit: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  safeEvaluate: vi.fn(),
  generateSessionDates: vi.fn(),
  createBookingAssignment: vi.fn(),
  getTrainerAvailabilityForClient: vi.fn(),
  isTimeWithinAvailability: vi.fn(),
  overlapsBusy: vi.fn(),
  utcToZonedDateAndMinutes: vi.fn(),
  createConnectCheckout: vi.fn(),
  isConnectConfigured: vi.fn(),
  resolveRequirePayment: vi.fn(),
  enrollInRun: vi.fn(),
  decideEnrollment: vi.fn(),
  effectiveCapacity: vi.fn(),
  enrolledCount: vi.fn(),
  dropInPriceCents: vi.fn(),
  withdrawEnrollment: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientProfileFindUnique },
    package: { findFirst: h.packageFindFirst },
    bookingRequest: { create: h.bookingRequestCreate },
    classRun: { findFirst: h.classRunFindFirst },
    classEnrollment: {
      findFirst: h.classEnrollmentFindFirst,
      findUnique: h.classEnrollmentFindUnique,
      update: h.classEnrollmentUpdate,
    },
    trainingSession: { findFirst: h.trainingSessionFindFirst },
    product: { findUnique: h.productFindUnique },
    productRequest: {
      findFirst: h.productRequestFindFirst,
      create: h.productRequestCreate,
      deleteMany: h.productRequestDeleteMany,
    },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    $transaction: h.txn,
  },
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/self-book', () => ({
  generateSessionDates: h.generateSessionDates,
  createBookingAssignment: h.createBookingAssignment,
}))
vi.mock('@/lib/client-availability', () => ({ getTrainerAvailabilityForClient: h.getTrainerAvailabilityForClient }))
vi.mock('@/lib/availability', () => ({
  isTimeWithinAvailability: h.isTimeWithinAvailability,
  overlapsBusy: h.overlapsBusy,
}))
vi.mock('@/lib/timezone', () => ({ utcToZonedDateAndMinutes: h.utcToZonedDateAndMinutes }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/require-payment', () => ({ resolveRequirePayment: h.resolveRequirePayment }))
vi.mock('@/lib/class-runs', () => ({
  enrollInRun: h.enrollInRun,
  ClassError: h.ClassError,
  decideEnrollment: h.decideEnrollment,
  effectiveCapacity: h.effectiveCapacity,
  enrolledCount: h.enrolledCount,
  dropInPriceCents: h.dropInPriceCents,
  withdrawEnrollment: h.withdrawEnrollment,
}))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))

import { POST as selfBookPOST } from '@/app/api/my/self-book/route'
import { POST as enrollPOST } from '@/app/api/my/classes/[runId]/enroll/route'
import { POST as requestPOST } from '@/app/api/my/products/[productId]/request/route'
import { POST as buyPOST } from '@/app/api/my/products/[productId]/buy/route'
import { DELETE as enrollmentDELETE } from '@/app/api/class-runs/[runId]/enrollments/[enrollmentId]/route'

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// A client profile with names + trainer routing (owner trainer, no assigned member).
const CLIENT_PROFILE = {
  id: 'cp1',
  trainerId: 'tp1',
  dogId: 'd1',
  dogs: [],
  user: { name: 'Liz Reed' },
  dog: { name: 'Rusty' },
  trainer: { user: { id: 'owner-user' } },
  assignedTrainer: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cp1', userId: 'u1', isPreview: false, actualUserId: 'u1' })
  h.clientProfileFindUnique.mockResolvedValue(CLIENT_PROFILE)
  h.enforceRateLimit.mockResolvedValue(null)
  h.createInvoiceForAssignment.mockResolvedValue(undefined)
  h.safeEvaluate.mockResolvedValue(undefined)
})

describe('self-book → CLIENT_BOOKED_SESSION', () => {
  beforeEach(() => {
    h.packageFindFirst.mockResolvedValue({
      id: 'pk1', name: 'Loose-lead walk', selfBookRequiresApproval: true,
      sessionCount: 1, weeksBetween: 1, durationMins: 60, bufferMins: 0, sessionType: 'PRIVATE',
      priceCents: 0, specialPriceCents: null,
    })
    h.getTrainerAvailabilityForClient.mockResolvedValue({ tz: 'Pacific/Auckland', slots: [], blackouts: [], busy: [] })
    h.utcToZonedDateAndMinutes.mockReturnValue({ dateStr: '2030-01-10', minuteOfDay: 600 })
    h.isTimeWithinAvailability.mockReturnValue(true)
    h.overlapsBusy.mockReturnValue(false)
    h.generateSessionDates.mockReturnValue([new Date('2030-01-10T10:00:00.000Z')])
    h.bookingRequestCreate.mockResolvedValue({ id: 'br1' })
  })

  it('notifies the owning trainer when a client submits a booking request', async () => {
    const res = await selfBookPOST(jsonReq('https://app.pupmanager.com/api/my/self-book', {
      packageId: 'pk1', startDate: '2030-01-10T10:00:00.000Z',
    }))
    expect(res.status).toBe(201)
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_BOOKED_SESSION',
      expect.objectContaining({ clientName: 'Liz Reed', dogName: 'Rusty', detail: expect.stringContaining('Loose-lead walk on') }),
      '/schedule',
      'tp1',
    )
  })

  it('does NOT notify (or create a booking) when a trainer is previewing the client app', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp1', userId: 'u1', isPreview: true, actualUserId: 'trainer-user' })
    const res = await selfBookPOST(jsonReq('https://app.pupmanager.com/api/my/self-book', {
      packageId: 'pk1', startDate: '2030-01-10T10:00:00.000Z',
    }))
    expect(res.status).toBe(403)
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })
})

describe('class enrol → CLIENT_BOOKED_SESSION', () => {
  const ctx = { params: Promise.resolve({ runId: 'run1' }) }
  beforeEach(() => {
    h.classRunFindFirst.mockResolvedValue({
      id: 'run1', name: 'Puppy Class', status: 'SCHEDULED', capacity: 10, requirePayment: false,
      package: { isGroup: true, allowDropIn: false, specialPriceCents: null, priceCents: 0, sessionCount: 6, capacity: 10, allowWaitlist: false, dropInPriceCents: null },
    })
    h.classEnrollmentFindFirst.mockResolvedValue(null)
    h.decideEnrollment.mockReturnValue('ENROLLED')
    h.effectiveCapacity.mockReturnValue(10)
    h.enrolledCount.mockResolvedValue(0)
    h.enrollInRun.mockResolvedValue({ status: 'ENROLLED', enrollmentId: 'e1' })
  })

  it('notifies the owning trainer when a client enrols in a free class', async () => {
    const res = await enrollPOST(jsonReq('https://app.pupmanager.com/api/my/classes/run1/enroll', {}), ctx)
    expect(res.status).toBe(201)
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_BOOKED_SESSION',
      expect.objectContaining({ clientName: 'Liz Reed', dogName: 'Rusty', detail: 'Puppy Class' }),
      '/classes/run1',
      'tp1',
    )
  })
})

describe('shop request → CLIENT_SHOP_ORDER', () => {
  const ctx = { params: Promise.resolve({ productId: 'prod1' }) }
  beforeEach(() => {
    h.productFindUnique.mockResolvedValue({ id: 'prod1', trainerId: 'tp1', active: true, name: 'Long-line lead' })
    h.productRequestFindFirst.mockResolvedValue(null)
    h.productRequestCreate.mockResolvedValue({ id: 'pr1' })
  })

  it('notifies the owning trainer when a client requests a product', async () => {
    const res = await requestPOST(jsonReq('https://app.pupmanager.com/api/my/products/prod1/request', undefined), ctx)
    expect(res.status).toBe(201)
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_SHOP_ORDER',
      expect.objectContaining({ clientName: 'Liz Reed', dogName: 'Rusty', detail: expect.stringContaining('requested') }),
      '/clients/cp1',
      'tp1',
    )
  })

  it('does NOT notify when a trainer is previewing the client app', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp1', userId: 'u1', isPreview: true, actualUserId: 'trainer-user' })
    const res = await requestPOST(jsonReq('https://app.pupmanager.com/api/my/products/prod1/request', undefined), ctx)
    expect(res.status).toBe(201)
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })
})

describe('shop buy → CLIENT_SHOP_ORDER (book-now-pay-later)', () => {
  const ctx = { params: Promise.resolve({ productId: 'prod1' }) }
  beforeEach(() => {
    h.productFindUnique.mockResolvedValue({ id: 'prod1', trainerId: 'tp1', active: true, name: 'Long-line lead', kind: 'PHYSICAL', priceCents: 1500, requirePayment: false })
    h.trainerProfileFindUnique.mockResolvedValue({ acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct1', payoutCurrency: 'nzd', sandboxBilling: true, defaultRequirePayment: false })
    h.resolveRequirePayment.mockReturnValue(false) // pay-later branch
    h.productRequestFindFirst.mockResolvedValue(null)
    h.productRequestCreate.mockResolvedValue({ id: 'pr1' })
  })

  it('notifies the owning trainer when a client buys (pay-later) a product', async () => {
    const res = await buyPOST(jsonReq('https://app.pupmanager.com/api/my/products/prod1/buy', {}), ctx)
    expect(res.status).toBe(200)
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_SHOP_ORDER',
      expect.objectContaining({ clientName: 'Liz Reed', dogName: 'Rusty', detail: expect.stringContaining('bought') }),
      '/clients/cp1',
      'tp1',
    )
  })
})

describe('cancel — no client-facing cancel route exists', () => {
  // The only enrolment-withdraw route is trainer-only (guardPermission +
  // role==='TRAINER'). A trainer cancelling must NOT fire a client-action
  // notification (they'd be notifying themselves), so this route stays clean.
  const ctx = { params: Promise.resolve({ runId: 'run1', enrollmentId: 'e1' }) }
  beforeEach(() => {
    h.guardPermission.mockResolvedValue({ companyId: 'tp1' })
    h.auth.mockResolvedValue({ user: { id: 'trainer-user', role: 'TRAINER', trainerId: 'tp1' } })
    h.classEnrollmentFindFirst.mockResolvedValue({ id: 'e1' })
    h.withdrawEnrollment.mockResolvedValue({ promotedEnrollmentId: null })
  })

  it('a trainer withdrawing an enrolment does not fire a client-action notification', async () => {
    const res = await enrollmentDELETE(new Request('https://app.pupmanager.com/api/class-runs/run1/enrollments/e1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(200)
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })
})
