import { describe, it, expect, vi, beforeEach } from 'vitest'

// The connect-checkout LIBRARY: server-computed totals + the surcharge line
// (createPaymentRecord) and the live-allowlist + direct-charge mint gate
// (mintCheckoutSession). We keep the REAL fee math from @/lib/connect (only the
// allowlist predicate is stubbed) so the production totals are asserted; Stripe
// + prisma are mocked so nothing hits the network or a DB.

const h = vi.hoisted(() => ({
  trainerProfileFindUnique: vi.fn(),
  paymentCreate: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  stripeFor: vi.fn(),
  env: { PLATFORM_FEE_BPS: 0 },
}))

vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: vi.fn(() => true) }))
// Real fee math; only the mint gate predicate is stubbed.
vi.mock('@/lib/connect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/connect')>('@/lib/connect')
  return { ...actual }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    payment: { create: h.paymentCreate, findUnique: h.paymentFindUnique, update: h.paymentUpdate },
  },
}))

import { createPaymentRecord, mintCheckoutSession } from '@/lib/connect-checkout'

beforeEach(() => {
  h.trainerProfileFindUnique.mockReset()
  h.paymentCreate.mockReset().mockResolvedValue({ id: 'pay_new' })
  h.paymentFindUnique.mockReset()
  h.paymentUpdate.mockReset().mockResolvedValue({})
  h.stripeFor.mockReset()
  h.env.PLATFORM_FEE_BPS = 0
})

describe('createPaymentRecord — server-computed totals + surcharge line', () => {
  it('appends a grossed-up surcharge when the trainer passes the fee on', async () => {
    h.trainerProfileFindUnique.mockResolvedValue({ passProcessingFeeToClient: true })
    const id = await createPaymentRecord({
      sandbox: true, trainerId: 't1', connectAccountId: 'acct_1', clientId: 'c1',
      currency: 'nzd',
      lines: [{ kind: 'PRODUCT', description: 'Leash', unitAmount: 10_000, quantity: 1 }],
    })
    expect(id).toBe('pay_new')
    const data = h.paymentCreate.mock.calls[0][0].data
    // subtotal 10000 + nzd surcharge 394 = 10394
    expect(data.amountTotal).toBe(10_394)
    const created = data.items.create
    expect(created).toHaveLength(2)
    expect(created[1].description).toBe('Card processing fee')
    expect(created[1].unitAmount).toBe(394)
    expect(created[1].intent).toEqual({ surcharge: true })
    // Our margin is stamped on the record at creation: 0.85% (NZD) of the
    // grossed-up 10394 = 88c. It used to be 0 here — that WAS the bug.
    expect(data.applicationFeeAmount).toBe(88)
    // record stamps the connected account + currency + PENDING status
    expect(data.connectAccountId).toBe('acct_1')
    expect(data.currency).toBe('nzd')
    expect(data.status).toBe('PENDING')
  })

  it('does NOT append a surcharge when the trainer absorbs the fee', async () => {
    h.trainerProfileFindUnique.mockResolvedValue({ passProcessingFeeToClient: false })
    await createPaymentRecord({
      sandbox: true, trainerId: 't1', connectAccountId: 'acct_1', clientId: 'c1',
      currency: 'nzd',
      lines: [{ kind: 'PRODUCT', description: 'Leash', unitAmount: 10_000, quantity: 1 }],
    })
    const data = h.paymentCreate.mock.calls[0][0].data
    expect(data.amountTotal).toBe(10_000)
    expect(data.items.create).toHaveLength(1)
  })

  it('respects quantity in the subtotal', async () => {
    h.trainerProfileFindUnique.mockResolvedValue({ passProcessingFeeToClient: false })
    await createPaymentRecord({
      sandbox: true, trainerId: 't1', connectAccountId: 'acct_1', clientId: 'c1',
      currency: 'nzd',
      lines: [{ kind: 'PRODUCT', description: 'Treats', unitAmount: 2_500, quantity: 3 }],
    })
    expect(h.paymentCreate.mock.calls[0][0].data.amountTotal).toBe(7_500)
  })

  it('stacks an application fee only when PLATFORM_FEE_BPS is configured', async () => {
    h.env.PLATFORM_FEE_BPS = 500
    h.trainerProfileFindUnique.mockResolvedValue({ passProcessingFeeToClient: false })
    await createPaymentRecord({
      sandbox: true, trainerId: 't1', connectAccountId: 'acct_1', clientId: 'c1',
      currency: 'nzd',
      lines: [{ kind: 'PRODUCT', description: 'Leash', unitAmount: 10_000, quantity: 1 }],
    })
    expect(h.paymentCreate.mock.calls[0][0].data.applicationFeeAmount).toBe(500)
  })
})

describe('mintCheckoutSession — direct charge on the connected account', () => {
  it('returns null for a non-PENDING payment (idempotency guard)', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PAID', sandbox: false, trainerId: 't1', connectAccountId: 'acct', currency: 'nzd', items: [] })
    const url = await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBeNull()
    expect(h.stripeFor).not.toHaveBeenCalled()
  })

  it('returns null for a missing payment', async () => {
    h.paymentFindUnique.mockResolvedValue(null)
    const url = await mintCheckoutSession('nope', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBeNull()
    expect(h.stripeFor).not.toHaveBeenCalled()
  })

  // The rollout allowlist is gone: an ordinary live trainer mints a real
  // checkout. The remaining money chokepoint is having a Connect account at all.
  it('refuses to mint when the trainer has no connected account', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PENDING', sandbox: false, trainerId: 't1', connectAccountId: null, currency: 'nzd', items: [{ quantity: 1, unitAmount: 5000, description: 'x' }] })
    const url = await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBeNull()
    expect(h.stripeFor).not.toHaveBeenCalled()
  })

  it('mints a DIRECT charge and sends our margin as the application fee', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' })
    h.stripeFor.mockReturnValue({ checkout: { sessions: { create } } })
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PENDING', sandbox: false, trainerId: 't1', connectAccountId: 'acct_dest', currency: 'nzd', applicationFeeAmount: 43, items: [{ quantity: 1, unitAmount: 5000, description: 'Leash' }] })

    const url = await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBe('https://checkout/cs_1')

    const [sessionArg, opts] = create.mock.calls[0]
    // Direct charge: second arg carries the Stripe-Account header.
    expect(opts).toEqual({ stripeAccount: 'acct_dest' })
    // Our cut, as stored on the Payment row. Omitting this is how we shipped
    // 0% margin on every payment — the regression this test exists to catch.
    expect(sessionArg.payment_intent_data.application_fee_amount).toBe(43)
    // Direct charge, so the trainer is merchant of record — never a transfer.
    expect(sessionArg).not.toHaveProperty('transfer_data')
    // Line items rebuilt from stored PaymentItems at the stored unit amount.
    expect(sessionArg.line_items[0].price_data.unit_amount).toBe(5000)
    expect(sessionArg.line_items[0].price_data.currency).toBe('nzd')
  })

  it('omits the application fee entirely when we take nothing (Stripe rejects a 0 fee)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' })
    h.stripeFor.mockReturnValue({ checkout: { sessions: { create } } })
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PENDING', sandbox: false, trainerId: 't1', connectAccountId: 'acct_dest', currency: 'zar', applicationFeeAmount: 0, items: [{ quantity: 1, unitAmount: 5000, description: 'Leash' }] })

    await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    const [sessionArg] = create.mock.calls[0]
    expect(sessionArg.payment_intent_data).not.toHaveProperty('application_fee_amount')
  })
})
