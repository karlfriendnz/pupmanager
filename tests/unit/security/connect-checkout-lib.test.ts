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
  isLivePaymentsAllowed: vi.fn(),
  env: { PLATFORM_FEE_BPS: 0, CONNECT_LIVE_ALLOWLIST: undefined as string | undefined },
}))

vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: vi.fn(() => true) }))
// Real fee math; only the mint gate predicate is stubbed.
vi.mock('@/lib/connect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/connect')>('@/lib/connect')
  return { ...actual, isLivePaymentsAllowed: h.isLivePaymentsAllowed }
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
  h.isLivePaymentsAllowed.mockReset().mockReturnValue(true)
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
    // direct charge ⇒ no application fee by default (PLATFORM_FEE_BPS 0)
    expect(data.applicationFeeAmount).toBe(0)
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

describe('mintCheckoutSession — live-allowlist gate + direct charge', () => {
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

  it('refuses to mint a LIVE checkout for a non-allowlisted trainer (money chokepoint)', async () => {
    h.isLivePaymentsAllowed.mockReturnValue(false)
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PENDING', sandbox: false, trainerId: 't-notlisted', connectAccountId: 'acct', currency: 'nzd', items: [{ quantity: 1, unitAmount: 5000, description: 'x' }] })
    const url = await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBeNull()
    expect(h.isLivePaymentsAllowed).toHaveBeenCalledWith('t-notlisted', false)
    expect(h.stripeFor).not.toHaveBeenCalled()
  })

  it('mints a DIRECT charge on the connected account (Stripe-Account header, no app fee/transfer)', async () => {
    h.isLivePaymentsAllowed.mockReturnValue(true)
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' })
    h.stripeFor.mockReturnValue({ checkout: { sessions: { create } } })
    h.paymentFindUnique.mockResolvedValue({ id: 'pay_1', status: 'PENDING', sandbox: false, trainerId: 't1', connectAccountId: 'acct_dest', currency: 'nzd', items: [{ quantity: 1, unitAmount: 5000, description: 'Leash' }] })

    const url = await mintCheckoutSession('pay_1', { successUrl: 's', cancelUrl: 'c' })
    expect(url).toBe('https://checkout/cs_1')

    const [sessionArg, opts] = create.mock.calls[0]
    // Direct charge: second arg carries the Stripe-Account header.
    expect(opts).toEqual({ stripeAccount: 'acct_dest' })
    // No application fee or transfer on a direct charge.
    expect(sessionArg.payment_intent_data).not.toHaveProperty('application_fee_amount')
    expect(sessionArg).not.toHaveProperty('transfer_data')
    // Line items rebuilt from stored PaymentItems at the stored unit amount.
    expect(sessionArg.line_items[0].price_data.unit_amount).toBe(5000)
    expect(sessionArg.line_items[0].price_data.currency).toBe('nzd')
  })
})
