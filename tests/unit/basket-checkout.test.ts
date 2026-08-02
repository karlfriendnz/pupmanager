import { describe, it, expect, vi, beforeEach } from 'vitest'

// ONE payment for a basket holding products AND classes.
//
// The four things that decide whether this feature is safe to take money with:
//
//   1. A mixed basket produces the right lines and the right total.
//   2. A line that went stale between adding and paying refuses the WHOLE
//      basket and names what went — nothing is charged, nothing is silently
//      dropped.
//   3. A double-tapped Pay button raises ONE payment.
//   4. A varianted product carries its variant all the way to the line.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  productFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  classRunFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  enrollmentAggregate: vi.fn(),
  createPaymentRecord: vi.fn(),
  mintCheckoutSession: vi.fn(),
  quoteOfferingDiscount: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    trainerProfile: { findUnique: h.trainerFindUnique },
    product: { findMany: h.productFindMany },
    payment: { findMany: h.paymentFindMany },
    classRun: { findFirst: h.classRunFindFirst },
    trainingSession: { findMany: h.sessionFindMany },
    classEnrollment: { findFirst: h.enrollmentFindFirst, aggregate: h.enrollmentAggregate },
  },
}))
vi.mock('@/lib/connect-checkout', () => ({
  createPaymentRecord: h.createPaymentRecord,
  mintCheckoutSession: h.mintCheckoutSession,
}))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: () => true }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn().mockResolvedValue(null) }))
// The scaling maths is real — it's what keeps the charge and the platform fee
// agreeing — only the rule lookup is stubbed.
vi.mock('@/lib/discounts/quote', async () => {
  const actual = await vi.importActual<typeof import('@/lib/discounts/quote')>('@/lib/discounts/quote')
  return { ...actual, quoteOfferingDiscount: h.quoteOfferingDiscount }
})

import { POST } from '@/app/api/my/basket/checkout/route'
import type { CheckoutLine } from '@/lib/connect-checkout'

const TRAINER = 'trainer_1'
const CLIENT = 'client_1'
const DOG = 'dog_1'

const day = (n: number) => new Date(Date.now() + n * 86_400_000)
const SESSIONS = [
  { id: 'sess_1', scheduledAt: day(7), slot: null },
  { id: 'sess_2', scheduledAt: day(14), slot: null },
]

const SMALL = { id: 'v_small', name: 'Small', priceCents: null, salePriceCents: null, stockCount: 3 }
const LARGE = { id: 'v_large', name: 'Large', priceCents: 6000, salePriceCents: null, stockCount: 1 }

const PRODUCTS = [
  { id: 'prod_line', name: 'Long line', kind: 'PHYSICAL', priceCents: 2500, salePriceCents: null, stockCount: 5, variants: [] },
  { id: 'prod_h', name: 'Front-clip harness', kind: 'PHYSICAL', priceCents: 4500, salePriceCents: null, stockCount: null, variants: [SMALL, LARGE] },
  { id: 'prod_pdf', name: 'Crate guide', kind: 'DIGITAL', priceCents: 900, salePriceCents: null, stockCount: null, variants: [] },
]

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run_1',
  name: 'Puppy Foundations',
  trainerId: TRAINER,
  status: 'SCHEDULED',
  capacity: null,
  packageId: 'pkg_1',
  package: {
    id: 'pkg_1', isGroup: true, allowDropIn: true, allowWaitlist: false,
    priceCents: null, specialPriceCents: null, dropInPriceCents: 3000, capacity: 6,
    ticketTiers: [],
  },
  ...over,
})

const productLine = (productId: string, quantity = 1, variantId: string | null = null) => ({
  kind: 'PRODUCT' as const,
  key: `PRODUCT:${productId}:${variantId ?? '-'}`,
  productId, variantId, quantity,
})

const classLine = (sessionIds = ['sess_1', 'sess_2']) => ({
  kind: 'CLASS' as const,
  key: `CLASS:run_1:DROP_IN:${[...sessionIds].sort().join(',')}:${DOG}:-`,
  classRunId: 'run_1',
  type: 'DROP_IN' as const,
  sessionIds,
  dogIds: [DOG],
  ticketTierId: null,
})

const post = (lines: unknown[], headers: Record<string, string> = {}) =>
  POST(new Request('https://app.pupmanager.com/api/my/basket/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ lines }),
  }))

/** The lines handed to createPaymentRecord on the most recent call. */
const sentLines = (): CheckoutLine[] => h.createPaymentRecord.mock.calls.at(-1)![0].lines
const sentTotal = () => sentLines().reduce((s, l) => s + l.unitAmount * (l.quantity ?? 1), 0)

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.getActiveClient.mockResolvedValue({ clientId: CLIENT, isPreview: false })
  h.clientFindUnique.mockResolvedValue({
    id: CLIENT, trainerId: TRAINER, dogId: DOG, dogs: [{ id: DOG, deceasedAt: null }], dog: { deceasedAt: null },
  })
  h.trainerFindUnique.mockResolvedValue({
    acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1',
    payoutCurrency: 'nzd', sandboxBilling: true,
  })
  h.productFindMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
    PRODUCTS.filter(p => args.where.id.in.includes(p.id)))
  h.paymentFindMany.mockResolvedValue([])
  h.classRunFindFirst.mockResolvedValue(run())
  h.sessionFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
    const wanted = args?.where?.id?.in
    // Two different callers: the drop-in picker (asks for named sessions) and
    // wholeRunPriceCents (asks for the run's lot).
    if (wanted) {
      return SESSIONS.filter(s => wanted.includes(s.id))
        .map(s => ({ id: s.id, scheduledAt: s.scheduledAt, packageSessionSlot: s.slot }))
    }
    return SESSIONS.map(s => ({ packageSessionSlot: s.slot }))
  })
  h.enrollmentFindFirst.mockResolvedValue(null)
  h.enrollmentAggregate.mockResolvedValue({ _sum: { quantity: 0 } })
  h.createPaymentRecord.mockResolvedValue('pay_1')
  h.mintCheckoutSession.mockResolvedValue('https://checkout.stripe.com/x')
  h.quoteOfferingDiscount.mockResolvedValue({ discountTotal: 0, lines: [] })
})

describe('a mixed product + class basket', () => {
  it('builds one payment with a line per product and a line per dog × session', async () => {
    const res = await post([productLine('prod_line', 2), classLine()])
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ url: 'https://checkout.stripe.com/x', paymentId: 'pay_1' })

    const lines = sentLines()
    expect(lines).toHaveLength(3) // the long line, plus one per drop-in session
    expect(lines[0]).toMatchObject({
      kind: 'PRODUCT', description: 'Long line', unitAmount: 2500, quantity: 2, productId: 'prod_line', variantId: null,
    })
    expect(lines[0].intent).toMatchObject({ productId: 'prod_line', variantId: null, quantity: 2 })
    expect(lines.slice(1).every(l => l.kind === 'CLASS_ENROLLMENT')).toBe(true)
    expect(lines.slice(1).map(l => l.unitAmount)).toEqual([3000, 3000])

    // 2 × $25 + 2 × $30 = $110.
    expect(sentTotal()).toBe(11000)
  })

  it('every class line carries the intent the webhook fulfils from', async () => {
    await post([classLine()])
    const intents = sentLines().map(l => l.intent)
    expect(intents).toEqual([
      { classRunId: 'run_1', type: 'DROP_IN', dogId: DOG, sessionId: 'sess_1' },
      { classRunId: 'run_1', type: 'DROP_IN', dogId: DOG, sessionId: 'sess_2' },
    ])
  })

  it('a class discount still fires, and comes off the CLASS lines only', async () => {
    // $9 off the two-session drop-in. The harness must not absorb any of it —
    // the rules are the offering's, not the shop's.
    h.quoteOfferingDiscount.mockResolvedValue({ discountTotal: 900, lines: [] })
    await post([productLine('prod_line', 1), classLine()])

    const lines = sentLines()
    expect(lines[0].unitAmount).toBe(2500) // product untouched
    expect(lines[1].unitAmount + lines[2].unitAmount).toBe(6000 - 900)
    expect(sentTotal()).toBe(2500 + 5100)

    // Quoted with exactly the arguments the single-item enrol route passes.
    expect(h.quoteOfferingDiscount).toHaveBeenCalledWith(expect.objectContaining({
      trainerId: TRAINER, packageId: 'pkg_1', dogCount: 1, perDogAmounts: [3000, 3000],
    }))
  })

  it('a shop-only basket comes back to the shop; anything with a class comes back to sessions', async () => {
    await post([productLine('prod_line')])
    expect(h.mintCheckoutSession.mock.calls[0][1].successUrl).toContain('/my-shop?basketPaid=1')
    await post([classLine()])
    expect(h.mintCheckoutSession.mock.calls[1][1].successUrl).toContain('/my-sessions?basketPaid=1')
  })
})

describe('a varianted product', () => {
  it('carries the variant on the line AND in the intent, at the variant’s own price', async () => {
    await post([productLine('prod_h', 1, 'v_large')])
    const line = sentLines()[0]
    expect(line).toMatchObject({
      description: 'Front-clip harness — Large', unitAmount: 6000, productId: 'prod_h', variantId: 'v_large',
    })
    expect(line.intent).toMatchObject({ productId: 'prod_h', variantId: 'v_large', quantity: 1 })
  })

  it('inherits the product’s price when the option has none', async () => {
    await post([productLine('prod_h', 1, 'v_small')])
    expect(sentLines()[0].unitAmount).toBe(4500)
  })

  it('refuses a product with options that names none', async () => {
    const res = await post([productLine('prod_h', 1, null)])
    expect(res.status).toBe(409)
    expect((await res.json()).unavailable[0].reason).toMatch(/Choose an option/)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })
})

describe('a line that went stale between adding and paying', () => {
  it('refuses the WHOLE basket and charges nothing when stock ran out', async () => {
    // Two left, three in the basket.
    h.productFindMany.mockResolvedValue([{ ...PRODUCTS[0], stockCount: 2 }])
    const res = await post([productLine('prod_line', 3)])

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.unavailable).toEqual([
      { key: 'PRODUCT:prod_line:-', reason: 'Only 2 of Long line left — you asked for 3.' },
    ])
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
    expect(h.mintCheckoutSession).not.toHaveBeenCalled()
  })

  it('takes the good lines down with the bad one — no partial charge', async () => {
    h.productFindMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
      PRODUCTS.filter(p => args.where.id.in.includes(p.id))
        .map(p => (p.id === 'prod_line' ? { ...p, stockCount: 0 } : p)))
    const res = await post([productLine('prod_line', 1), productLine('prod_h', 1, 'v_small'), classLine()])

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.unavailable).toHaveLength(1)
    expect(body.unavailable[0].key).toBe('PRODUCT:prod_line:-')
    // The harness and the class were both fine — and still nothing was charged.
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('names each failure separately when several went', async () => {
    h.productFindMany.mockResolvedValue([{ ...PRODUCTS[0], stockCount: 0 }])
    h.classRunFindFirst.mockResolvedValue(run({ status: 'CANCELLED' }))
    const res = await post([productLine('prod_line'), classLine()])

    const body = await res.json()
    expect(body.error).toBe('2 things in your basket are no longer available.')
    expect(body.unavailable.map((u: { key: string }) => u.key)).toEqual([
      'PRODUCT:prod_line:-', classLine().key,
    ])
  })

  it('refuses when a chosen session has already run', async () => {
    // The picker query filters on scheduledAt >= now, so a session that has
    // been simply isn't returned.
    h.sessionFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) =>
      args?.where?.id?.in
        ? [{ id: 'sess_2', scheduledAt: SESSIONS[1].scheduledAt, packageSessionSlot: null }]
        : SESSIONS.map(s => ({ packageSessionSlot: s.slot })))
    const res = await post([classLine()])
    expect(res.status).toBe(409)
    expect((await res.json()).unavailable[0].reason).toMatch(/already been/)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('refuses when the seat went — and never quietly waitlists inside a basket', async () => {
    // Capacity 6, six already in the room.
    h.enrollmentAggregate.mockResolvedValue({ _sum: { quantity: 6 } })
    h.classRunFindFirst.mockResolvedValue(run({ package: { ...run().package, allowWaitlist: true } }))
    const res = await post([classLine()])

    expect(res.status).toBe(409)
    expect((await res.json()).unavailable[0].reason).toMatch(/filled up/)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('refuses a class they are already enrolled in', async () => {
    h.enrollmentFindFirst.mockResolvedValue({ id: 'enr_1' })
    const res = await post([classLine()])
    expect(res.status).toBe(409)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('refuses a digital product inside the native app (Apple 3.1.1)', async () => {
    const res = await post([productLine('prod_pdf')], { 'x-pm-platform': 'ios' })
    expect(res.status).toBe(409)
    expect((await res.json()).unavailable[0].reason).toMatch(/only be bought on the web/)
  })
})

describe('a double-tapped Pay button', () => {
  it('re-uses the pending payment instead of raising a second one', async () => {
    const basket = [productLine('prod_line', 2), classLine()]

    const first = await post(basket)
    expect(await first.json()).toMatchObject({ paymentId: 'pay_1', reused: false })

    // The second tap arrives before anyone has paid: the same PENDING Payment
    // is sitting there, with the surcharge line createPaymentRecord appended.
    h.paymentFindMany.mockResolvedValue([{
      id: 'pay_1',
      items: [
        ...sentLines().map(l => ({
          kind: l.kind, unitAmount: l.unitAmount, quantity: l.quantity ?? 1,
          productId: l.productId ?? null, variantId: l.variantId ?? null, intent: l.intent,
        })),
        { kind: 'PRODUCT', unitAmount: 210, quantity: 1, productId: null, variantId: null, intent: { surcharge: true } },
      ],
    }])

    const second = await post(basket)
    expect(await second.json()).toMatchObject({ paymentId: 'pay_1', reused: true })

    // ONE payment row, two Stripe sessions — and only a completed session ever
    // charges, so the client cannot be billed twice.
    expect(h.createPaymentRecord).toHaveBeenCalledTimes(1)
    expect(h.mintCheckoutSession).toHaveBeenCalledTimes(2)
  })

  it('a DIFFERENT basket is not mistaken for the pending one', async () => {
    await post([productLine('prod_line', 2)])
    h.paymentFindMany.mockResolvedValue([{
      id: 'pay_1',
      items: sentLines().map(l => ({
        kind: l.kind, unitAmount: l.unitAmount, quantity: l.quantity ?? 1,
        productId: l.productId ?? null, variantId: l.variantId ?? null, intent: l.intent,
      })),
    }])

    // They went back and added one more.
    const res = await post([productLine('prod_line', 3)])
    expect(await res.json()).toMatchObject({ reused: false })
    expect(h.createPaymentRecord).toHaveBeenCalledTimes(2)
  })
})

describe('who may check a basket out', () => {
  it('refuses a signed-out visitor', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await post([productLine('prod_line')])).status).toBe(401)
  })

  it('refuses a trainer previewing a client’s app — that would be a real charge', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: CLIENT, isPreview: true })
    expect((await post([productLine('prod_line')])).status).toBe(403)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('never sells another business’s product', async () => {
    // The query is tenant-scoped, so a foreign id resolves to nothing at all.
    h.productFindMany.mockResolvedValue([])
    const res = await post([productLine('prod_from_another_shop')])
    expect(res.status).toBe(409)
    expect((await res.json()).unavailable[0].reason).toMatch(/isn’t in the shop/)
  })

  it('never sells another business’s class', async () => {
    h.classRunFindFirst.mockResolvedValue(null)
    const res = await post([classLine()])
    expect(res.status).toBe(409)
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('refuses when the trainer isn’t taking cards at all', async () => {
    h.trainerFindUnique.mockResolvedValue({
      acceptPaymentsEnabled: false, connectChargesEnabled: false, connectAccountId: null,
      payoutCurrency: 'nzd', sandboxBilling: true,
    })
    expect((await post([productLine('prod_line')])).status).toBe(409)
  })

  it('rejects an empty or oversized basket', async () => {
    expect((await post([])).status).toBe(400)
    expect((await post(Array.from({ length: 41 }, () => productLine('prod_line')))).status).toBe(400)
  })
})
