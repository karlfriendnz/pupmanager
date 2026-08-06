import { describe, it, expect, vi, beforeEach } from 'vitest'

// The point of a sale price is that it's the number the CLIENT is charged.
// This pins the client-facing buy route: the Stripe line and the pay-later
// invoice both have to come out at the sale price, resolved server-side from
// the row (never from the request), with the normal price left alone.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  productFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  requestFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  createConnectCheckout: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  resolveRequirePayment: vi.fn(),
  takeStock: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    product: { findUnique: h.productFindUnique },
    trainerProfile: { findUnique: h.trainerFindUnique },
    productRequest: {
      findFirst: h.requestFindFirst,
      create: h.requestCreate,
      update: vi.fn(async () => ({ id: 'pr1', quantity: 2 })),
    },
    // placeProductOrder reads the receivable before deciding whether to raise
    // one or re-price the one already there.
    invoice: { findFirst: vi.fn(async () => null) },
    invoiceLineItem: { update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: () => true }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/require-payment', () => ({ resolveRequirePayment: h.resolveRequirePayment }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/stock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stock')>('@/lib/stock')
  return { ...actual, takeStock: h.takeStock }
})

import { POST } from '@/app/api/my/products/[productId]/buy/route'

const PRODUCT = 'prod_1'
const TRAINER = 'trainer_1'

const buy = () =>
  POST(
    new Request(`https://app.pupmanager.com/api/my/products/${PRODUCT}/buy`, { method: 'POST' }),
    { params: Promise.resolve({ productId: PRODUCT }) }
  )

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.getActiveClient.mockResolvedValue({ clientId: 'client_1', isPreview: false })
  h.clientFindUnique.mockResolvedValue({
    id: 'client_1',
    trainerId: TRAINER,
    user: { name: 'Sarah' },
    dog: { name: 'Bailey' },
    trainer: { user: { id: 'user_t' } },
    assignedTrainer: null,
  })
  h.trainerFindUnique.mockResolvedValue({
    acceptPaymentsEnabled: true,
    connectChargesEnabled: true,
    connectAccountId: 'acct_1',
    payoutCurrency: 'nzd',
    sandboxBilling: true,
    defaultRequirePayment: true,
  })
  h.resolveRequirePayment.mockReturnValue(true)
  h.createConnectCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
  h.createInvoiceForAssignment.mockResolvedValue('inv_1')
  h.requestFindFirst.mockResolvedValue(null)
  h.requestCreate.mockResolvedValue({ id: 'pr1', quantity: 1 })
  h.takeStock.mockResolvedValue(true)
  h.notifyTrainer.mockResolvedValue(undefined)
})

const product = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  trainerId: TRAINER,
  active: true,
  name: 'Long line — 10m',
  kind: 'PHYSICAL',
  priceCents: 4500,
  salePriceCents: null,
  requirePayment: null,
  stockCount: null,
  ...over,
})

describe('POST /api/my/products/[id]/buy — the sale price is what gets charged', () => {
  it('checks out at the SALE price, not the normal one', async () => {
    h.productFindUnique.mockResolvedValue(product({ salePriceCents: 2900 }))
    const res = await buy()
    expect(res.status).toBe(200)
    const line = h.createConnectCheckout.mock.calls[0][0].lines[0]
    expect(line.unitAmount).toBe(2900)
    expect(line.description).toBe('Long line — 10m (sale)')
  })

  it('checks out at the normal price when nothing is on sale', async () => {
    h.productFindUnique.mockResolvedValue(product())
    await buy()
    expect(h.createConnectCheckout.mock.calls[0][0].lines[0].unitAmount).toBe(4500)
  })

  it('a sale price of zero makes the item free rather than "not for sale"', async () => {
    h.productFindUnique.mockResolvedValue(product({ salePriceCents: 0 }))
    const res = await buy()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/isn’t for sale online/)
  })

  it('an unpriced product still refuses online checkout', async () => {
    h.productFindUnique.mockResolvedValue(product({ priceCents: null }))
    expect((await buy()).status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('the pay-later branch raises the invoice from the product, so it prices itself', async () => {
    h.resolveRequirePayment.mockReturnValue(false)
    h.productFindUnique.mockResolvedValue(product({ salePriceCents: 2900 }))
    const res = await buy()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'requested' })
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'PRODUCT', productId: PRODUCT })
    )
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('refuses another trainer’s product', async () => {
    h.productFindUnique.mockResolvedValue(product({ trainerId: 'other_trainer', salePriceCents: 2900 }))
    expect((await buy()).status).toBe(404)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('a trainer previewing the client app can never trigger a charge', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'client_1', isPreview: true })
    expect((await buy()).status).toBe(403)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('an out-of-stock product is refused before any money moves', async () => {
    h.productFindUnique.mockResolvedValue(product({ stockCount: 0, salePriceCents: 2900 }))
    expect((await buy()).status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })
})
