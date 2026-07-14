import { describe, it, expect, vi, beforeEach } from 'vitest'

// A refunded sale must cost the trainer NOTHING. These are direct charges, so
// the refund comes out of the trainer's own balance — if we don't hand our
// application fee back with refund_application_fee, the platform quietly keeps
// its cut on a sale that never happened and the trainer funds it. That is the
// regression this file exists to prevent.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  enforceRateLimit: vi.fn(async (): Promise<Response | null> => null),
  getClientIp: vi.fn(() => '1.2.3.4'),
  paymentFindUnique: vi.fn(),
  paymentUpdateMany: vi.fn(),
  paymentUpdate: vi.fn(),
  refundCreate: vi.fn(),
  refundRowCreate: vi.fn(),
  stripeFor: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findUnique: h.paymentFindUnique, updateMany: h.paymentUpdateMany, update: h.paymentUpdate },
    refund: { create: h.refundRowCreate },
  },
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: vi.fn(() => true) }))
vi.mock('@/lib/audit', () => ({ recordAudit: h.recordAudit, auditRequestMeta: () => ({}) }))

import { POST } from '@/app/api/trainer/payments/[id]/refund/route'

const OWNER = { userId: 'u1', companyId: 't1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function call(body?: unknown) {
  return POST(
    new Request('https://app.pupmanager.com/api/trainer/payments/pay_1/refund', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id: 'pay_1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue(OWNER)
  h.requireSameOrigin.mockReturnValue(null)
  h.enforceRateLimit.mockResolvedValue(null)
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay_1',
    trainerId: 't1',
    status: 'PAID',
    sandbox: false,
    amountTotal: 10_000,
    amountRefunded: 0,
    currency: 'nzd',
    applicationFeeAmount: 85,
    connectAccountId: 'acct_1',
    stripePaymentIntentId: 'pi_1',
  })
  h.paymentUpdateMany.mockResolvedValue({ count: 1 })
  h.refundCreate.mockResolvedValue({ id: 're_1', status: 'succeeded' })
  h.stripeFor.mockReturnValue({ refunds: { create: h.refundCreate } })
})

describe('refund — our margin goes back with the money', () => {
  it('reverses the application fee on a full refund', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const [args] = h.refundCreate.mock.calls[0]
    expect(args.refund_application_fee).toBe(true)
    expect(args.amount).toBe(10_000)
    expect(args.payment_intent).toBe('pi_1')
  })

  it('reverses the fee on a PARTIAL refund too (Stripe prorates it)', async () => {
    const res = await call({ amount: 2_500 })
    expect(res.status).toBe(200)
    const [args] = h.refundCreate.mock.calls[0]
    expect(args.amount).toBe(2_500)
    expect(args.refund_application_fee).toBe(true)
  })

  it('issues the refund in the connected account context (direct charge)', async () => {
    await call()
    const [, opts] = h.refundCreate.mock.calls[0]
    expect(opts).toMatchObject({ stripeAccount: 'acct_1' })
  })

  it('still refuses a cross-tenant refund', async () => {
    h.paymentFindUnique.mockResolvedValue({
      id: 'pay_1', trainerId: 'someone-else', status: 'PAID', sandbox: false,
      amountTotal: 10_000, amountRefunded: 0, currency: 'nzd', applicationFeeAmount: 85,
      connectAccountId: 'acct_x', stripePaymentIntentId: 'pi_x',
    })
    const res = await call()
    expect(res.status).toBe(404)
    expect(h.refundCreate).not.toHaveBeenCalled()
  })
})
