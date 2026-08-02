import { describe, it, expect, vi, beforeEach } from 'vitest'

// Buying a varianted product. Two things have to hold or the feature is
// unusable at the point that matters — handing the thing over:
//
//   1. A product WITH options cannot be bought without naming one.
//   2. The variant is recorded on everything the purchase leaves behind: the
//      stock line, the ProductRequest, the Stripe line and the invoice.
//
// And the third, which is the acceptance test for the whole change: a product
// with NO variants behaves exactly as it did (tests/unit/product-buy-sale-price).
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
    productRequest: { findFirst: h.requestFindFirst, create: h.requestCreate },
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

const buy = (body?: Record<string, unknown>) =>
  POST(
    new Request(`https://app.pupmanager.com/api/my/products/${PRODUCT}/buy`, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ productId: PRODUCT }) },
  )

const SMALL = { id: 'v_small', name: 'Small', priceCents: null, salePriceCents: null, stockCount: 3 }
const LARGE = { id: 'v_large', name: 'Large', priceCents: 6000, salePriceCents: null, stockCount: 1 }

const product = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  trainerId: TRAINER,
  active: true,
  name: 'Front-clip harness',
  kind: 'PHYSICAL',
  priceCents: 4500,
  salePriceCents: null,
  requirePayment: null,
  stockCount: null,
  variants: [SMALL, LARGE],
  ...over,
})

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
  h.takeStock.mockResolvedValue(true)
  h.notifyTrainer.mockResolvedValue(undefined)
  h.productFindUnique.mockResolvedValue(product())
})

describe('POST /api/my/products/[id]/buy — with options', () => {
  it('refuses a purchase that names no option', async () => {
    const res = await buy()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Choose an option/)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('refuses an option that isn’t on this product', async () => {
    const res = await buy({ variantId: 'v_from_another_shop' })
    expect(res.status).toBe(404)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('charges the option’s OWN price when it has one', async () => {
    await buy({ variantId: 'v_large' })
    const line = h.createConnectCheckout.mock.calls[0][0].lines[0]
    expect(line.unitAmount).toBe(6000)
    expect(line.description).toBe('Front-clip harness — Large')
    expect(line.variantId).toBe('v_large')
    expect(line.intent).toMatchObject({ productId: PRODUCT, variantId: 'v_large' })
  })

  it('charges the PRODUCT’s price when the option inherits it', async () => {
    await buy({ variantId: 'v_small' })
    expect(h.createConnectCheckout.mock.calls[0][0].lines[0].unitAmount).toBe(4500)
  })

  it('checks the OPTION’s stock, not the product’s', async () => {
    // The product's own count says "plenty"; the Large is gone. The Large is
    // what is being sold.
    h.productFindUnique.mockResolvedValue(product({
      stockCount: 99,
      variants: [SMALL, { ...LARGE, stockCount: 0 }],
    }))
    const res = await buy({ variantId: 'v_large' })
    expect(res.status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('a sold-out size does not block a size that is in stock', async () => {
    h.productFindUnique.mockResolvedValue(product({
      stockCount: 0,
      variants: [SMALL, { ...LARGE, stockCount: 0 }],
    }))
    expect((await buy({ variantId: 'v_small' })).status).toBe(200)
  })

  it('the pay-later branch records the option on the request, the shelf and the invoice', async () => {
    h.resolveRequirePayment.mockReturnValue(false)
    const res = await buy({ variantId: 'v_large' })
    expect(res.status).toBe(200)

    expect(h.takeStock).toHaveBeenCalledWith(
      expect.anything(), PRODUCT, expect.objectContaining({ variantId: 'v_large' }),
    )
    expect(h.requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: PRODUCT, variantId: 'v_large', status: 'PENDING' }),
    })
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT, productVariantId: 'v_large' }),
    )
  })

  it('a pending Small does not swallow an order for a Large', async () => {
    h.resolveRequirePayment.mockReturnValue(false)
    await buy({ variantId: 'v_large' })
    // The idempotency lookup is per (client, product, VARIANT) — otherwise the
    // second size returns the first size's row and is never ordered.
    expect(h.requestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variantId: 'v_large' }) }),
    )
  })

  it('the trainer’s alert names the size — "a harness" cannot be fetched', async () => {
    h.resolveRequirePayment.mockReturnValue(false)
    await buy({ variantId: 'v_large' })
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'user_t',
      'CLIENT_SHOP_ORDER',
      expect.objectContaining({ detail: expect.stringContaining('Front-clip harness — Large') }),
      expect.anything(),
      TRAINER,
    )
  })
})

describe('POST /api/my/products/[id]/buy — a product with NO options is unchanged', () => {
  const plain = () => product({ variants: [], priceCents: 4500 })

  it('buys in one step, with no option and no variant recorded anywhere', async () => {
    h.productFindUnique.mockResolvedValue(plain())
    const res = await buy()
    expect(res.status).toBe(200)
    const line = h.createConnectCheckout.mock.calls[0][0].lines[0]
    expect(line.unitAmount).toBe(4500)
    expect(line.description).toBe('Front-clip harness')
    expect(line.variantId).toBeNull()
  })

  it('still reads its own stockCount', async () => {
    h.productFindUnique.mockResolvedValue(plain())
    h.productFindUnique.mockResolvedValue(product({ variants: [], stockCount: 0 }))
    expect((await buy()).status).toBe(409)
  })

  it('pay-later still takes stock off the product and invoices with no variant', async () => {
    h.resolveRequirePayment.mockReturnValue(false)
    h.productFindUnique.mockResolvedValue(plain())
    await buy()
    expect(h.takeStock).toHaveBeenCalledWith(
      expect.anything(), PRODUCT, expect.objectContaining({ variantId: null }),
    )
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT, productVariantId: null }),
    )
  })
})
