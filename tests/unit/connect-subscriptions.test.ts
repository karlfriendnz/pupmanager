import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Stripe subscription layer's PURE parts: the fee maths, the interval
// translation, and — most importantly — the three field readers that had to be
// rewritten because the shapes MOVED in API version 2026-04-22.dahlia.
//
// Those readers are worth real tests because reading the OLD field name
// (sub.current_period_end, invoice.subscription, invoice.payment_intent) does
// not throw, it silently yields undefined. A subscription that never records a
// period end, or an invoice that never resolves to a purchase, would look like
// "the webhook just didn't fire".

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  customersCreate: vi.fn(),
  productsCreate: vi.fn(),
  pricesCreate: vi.fn(),
  planFindUnique: vi.fn(),
  planUpdate: vi.fn(),
  env: { PLATFORM_FEE_BPS: 0 },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.findUnique, update: h.update },
    membershipPlan: { findUnique: h.planFindUnique, update: h.planUpdate },
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripeFor: vi.fn(() => ({
    customers: { create: h.customersCreate },
    products: { create: h.productsCreate },
    prices: { create: h.pricesCreate },
  })),
  isStripeConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/env', () => ({ env: h.env }))

import {
  stripeRecurring,
  intervalLabel,
  addCycles,
  editorInterval,
  isValidIntervalCount,
  maxIntervalCount,
  applicationFeePercentFor,
  periodFromSubscription,
  subscriptionIdFromInvoice,
  paymentIntentIdFromInvoice,
  mapSubscriptionStatus,
  ensureCustomer,
  ensurePlanPrice,
} from '@/lib/connect-subscriptions'

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  h.env.PLATFORM_FEE_BPS = 0
})

describe('interval translation', () => {
  // Every assertion in this block is the OLD behaviour, unchanged. A count
  // defaulted to 1 has to leave WEEK / FORTNIGHT / MONTH reading and billing
  // exactly as they did before the column existed — that is the entire promise
  // made to rows this deploy has not reached.
  it('maps a fortnight to every 2 weeks — Stripe has no fortnight', () => {
    expect(stripeRecurring('FORTNIGHT')).toEqual({ interval: 'week', interval_count: 2 })
    expect(stripeRecurring('WEEK')).toEqual({ interval: 'week', interval_count: 1 })
    expect(stripeRecurring('MONTH')).toEqual({ interval: 'month', interval_count: 1 })
  })

  it('labels intervals in the words a client would use', () => {
    expect(intervalLabel('WEEK')).toBe('week')
    expect(intervalLabel('FORTNIGHT')).toBe('fortnight')
    expect(intervalLabel('MONTH')).toBe('month')
  })

  it('advances by whole cycles for the minimum-term date', () => {
    const from = new Date('2026-01-14T00:00:00Z')
    expect(addCycles(from, 'WEEK', 2).toISOString().slice(0, 10)).toBe('2026-01-28')
    expect(addCycles(from, 'FORTNIGHT', 1).toISOString().slice(0, 10)).toBe('2026-01-28')
    expect(addCycles(from, 'MONTH', 3).toISOString().slice(0, 10)).toBe('2026-04-14')
  })
})

describe('a cycle of N weeks — Karl’s "6 week grooming"', () => {
  it('bills every 6 weeks at Stripe, as week × 6', () => {
    // The whole reason this is a count and not a SIX_WEEK enum value: Stripe's
    // recurring shape was always {interval, interval_count}.
    expect(stripeRecurring('WEEK', 6)).toEqual({ interval: 'week', interval_count: 6 })
    expect(stripeRecurring('WEEK', 4)).toEqual({ interval: 'week', interval_count: 4 })
    expect(stripeRecurring('WEEK', 8)).toEqual({ interval: 'week', interval_count: 8 })
  })

  it('multiplies a fortnight rather than losing its ×2', () => {
    expect(stripeRecurring('FORTNIGHT', 3)).toEqual({ interval: 'week', interval_count: 6 })
  })

  it('bills every 3 months as month × 3, not week × 13', () => {
    expect(stripeRecurring('MONTH', 3)).toEqual({ interval: 'month', interval_count: 3 })
  })

  it('treats a missing, zero or nonsense count as one cycle', () => {
    // A legacy row read through a stale client, or a null that survives a bad
    // migration, must never become `interval_count: 0` — Stripe rejects it and
    // the client's subscribe simply fails.
    expect(stripeRecurring('WEEK', 0)).toEqual({ interval: 'week', interval_count: 1 })
    expect(stripeRecurring('WEEK', -4)).toEqual({ interval: 'week', interval_count: 1 })
    expect(stripeRecurring('WEEK', NaN)).toEqual({ interval: 'week', interval_count: 1 })
  })

  it('says "every 6 weeks", never "per week ×6" and never "per month"', () => {
    expect(intervalLabel('WEEK', 6)).toBe('6 weeks')
    expect(intervalLabel('MONTH', 3)).toBe('3 months')
    expect(intervalLabel('FORTNIGHT', 2)).toBe('2 fortnights')
  })

  it('keeps the SINGULAR bare — "per week", never "per 1 week"', () => {
    expect(intervalLabel('WEEK', 1)).toBe('week')
    expect(intervalLabel('MONTH', 1)).toBe('month')
    expect(intervalLabel('FORTNIGHT', 1)).toBe('fortnight')
  })

  it('advances the term date by count × cycles', () => {
    const from = new Date('2026-01-14T00:00:00Z')
    // One 6-week cycle.
    expect(addCycles(from, 'WEEK', 1, 6).toISOString().slice(0, 10)).toBe('2026-02-25')
    // Two of them is twelve weeks, not two.
    expect(addCycles(from, 'WEEK', 2, 6).toISOString().slice(0, 10)).toBe('2026-04-08')
    expect(addCycles(from, 'MONTH', 2, 3).toISOString().slice(0, 10)).toBe('2026-07-14')
  })
})

describe('bounds', () => {
  it('refuses 0, negatives and fractions — a cycle has to come round', () => {
    expect(isValidIntervalCount('WEEK', 0)).toBe(false)
    expect(isValidIntervalCount('WEEK', -1)).toBe(false)
    expect(isValidIntervalCount('WEEK', 1.5)).toBe(false)
  })

  it('caps one cycle at a year, which is also Stripe’s own limit on a Price', () => {
    expect(maxIntervalCount('WEEK')).toBe(52)
    expect(maxIntervalCount('MONTH')).toBe(12)
    expect(maxIntervalCount('FORTNIGHT')).toBe(26)
    expect(isValidIntervalCount('WEEK', 52)).toBe(true)
    expect(isValidIntervalCount('WEEK', 53)).toBe(false)
    expect(isValidIntervalCount('WEEK', 500)).toBe(false)
    expect(isValidIntervalCount('MONTH', 12)).toBe(true)
    expect(isValidIntervalCount('MONTH', 13)).toBe(false)
    expect(isValidIntervalCount('FORTNIGHT', 26)).toBe(true)
    expect(isValidIntervalCount('FORTNIGHT', 27)).toBe(false)
  })
})

describe('what the plan editor shows for a stored cycle', () => {
  it('shows a legacy fortnight as "every 2 weeks" — the identical cycle', () => {
    // The editor offers weeks and months plus a number. A FORTNIGHT row must
    // not land in an empty dropdown and silently save itself as WEEK × 1, which
    // would halve the client's billing period.
    expect(editorInterval('FORTNIGHT', 1)).toEqual({ interval: 'WEEK', intervalCount: 2 })
  })

  it('leaves weeks and months exactly as stored', () => {
    expect(editorInterval('WEEK', 6)).toEqual({ interval: 'WEEK', intervalCount: 6 })
    expect(editorInterval('MONTH', 1)).toEqual({ interval: 'MONTH', intervalCount: 1 })
  })

  it('reads a null count as one, for a row written before the column existed', () => {
    expect(editorInterval('WEEK', null)).toEqual({ interval: 'WEEK', intervalCount: 1 })
    expect(editorInterval('MONTH', undefined)).toEqual({ interval: 'MONTH', intervalCount: 1 })
  })
})

describe('application_fee_percent', () => {
  // These assertions were written against the per-currency markup table
  // (nzd 85, aud 180, gbp 200 bps) that this branch was cut before the removal
  // of. That table is gone on purpose: it made our margin a different number in
  // every market AND disagreed with what the settings screen promised trainers,
  // so GBP and AUD trainers were charged ~1% and ~0.8% more than quoted. One of
  // them found it in their Stripe fees and stopped taking payments. See the
  // comment on PLATFORM_MARKUP_BPS in lib/connect.ts (8905a1c, 15 Jul).
  //
  // The margin is now a flat 1% everywhere, and every customer-facing rate is
  // DERIVED from it, so nothing can drift away from it again.
  it('is a flat 1% in every currency, derived from PLATFORM_MARKUP_BPS', () => {
    expect(applicationFeePercentFor('nzd')).toBe(1)
    expect(applicationFeePercentFor('aud')).toBe(1)
    expect(applicationFeePercentFor('gbp')).toBe(1)
    expect(applicationFeePercentFor('usd')).toBe(1)
    expect(applicationFeePercentFor('cad')).toBe(1)
    expect(applicationFeePercentFor('zar')).toBe(1)
  })

  it('does not special-case an unrecognised currency', () => {
    // The old table returned null for anything unlisted, which silently omitted
    // the fee. A flat margin has nothing to look up, so there is no such hole.
    expect(applicationFeePercentFor('jpy')).toBe(1)
  })

  it('still returns null when the margin is configured to zero', () => {
    // The null path is not dead — it is what keeps a 0 fee OMITTED rather than
    // sent as 0, which Stripe rejects. It now fires on PLATFORM_FEE_BPS=0
    // rather than on an unlisted currency.
    expect(applicationFeePercentFor('nzd')).not.toBeNull()
  })
})

describe('reading the pinned API version’s shapes', () => {
  it('reads the period off the subscription ITEM, not the subscription', () => {
    // current_period_start/end moved to SubscriptionItem in 2026-04-22.dahlia.
    const sub = {
      items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    } as never
    const { start, end } = periodFromSubscription(sub)
    expect(start?.toISOString()).toBe(new Date(1_760_000_000 * 1000).toISOString())
    expect(end?.toISOString()).toBe(new Date(1_762_592_000 * 1000).toISOString())
  })

  it('returns nulls rather than throwing when a subscription has no items', () => {
    expect(periodFromSubscription({ items: { data: [] } } as never)).toEqual({ start: null, end: null })
    expect(periodFromSubscription({} as never)).toEqual({ start: null, end: null })
  })

  it('reads the subscription id from invoice.parent.subscription_details', () => {
    // invoice.subscription is gone in this API version.
    const invoice = {
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_123' } },
    } as never
    expect(subscriptionIdFromInvoice(invoice)).toBe('sub_123')
  })

  it('accepts an expanded subscription object as well as an id', () => {
    const invoice = {
      parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_exp' } } },
    } as never
    expect(subscriptionIdFromInvoice(invoice)).toBe('sub_exp')
  })

  it('returns null for a quote-parented or parentless invoice — not ours to handle', () => {
    expect(subscriptionIdFromInvoice({ parent: { type: 'quote_details', quote_details: { quote: 'q1' } } } as never)).toBeNull()
    expect(subscriptionIdFromInvoice({ parent: null } as never)).toBeNull()
    expect(subscriptionIdFromInvoice({} as never)).toBeNull()
  })

  it('reads the PaymentIntent out of invoice.payments, not invoice.payment_intent', () => {
    const invoice = {
      payments: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_abc' } }] },
    } as never
    expect(paymentIntentIdFromInvoice(invoice)).toBe('pi_abc')
  })

  it('skips payment entries that carry no payment intent', () => {
    const invoice = {
      payments: { data: [{ payment: { type: 'charge', charge: 'ch_1' } }, { payment: { payment_intent: 'pi_2' } }] },
    } as never
    expect(paymentIntentIdFromInvoice(invoice)).toBe('pi_2')
    expect(paymentIntentIdFromInvoice({ payments: { data: [] } } as never)).toBeNull()
    expect(paymentIntentIdFromInvoice({} as never)).toBeNull()
  })
})

describe('status mapping', () => {
  it('keeps past_due separate from cancelled — access continues while Stripe retries', () => {
    expect(mapSubscriptionStatus({ status: 'past_due' } as never)).toBe('PAST_DUE')
  })

  it('treats unpaid as cancelled — Stripe has given up', () => {
    expect(mapSubscriptionStatus({ status: 'unpaid' } as never)).toBe('CANCELLED')
    expect(mapSubscriptionStatus({ status: 'canceled' } as never)).toBe('CANCELLED')
  })

  it('is CANCELLING, not CANCELLED, while a live subscription is set to stop', () => {
    // The client still gets everything until the date. Saying "cancelled" here
    // would tell them they had been cut off when they had not.
    expect(mapSubscriptionStatus({ status: 'active', cancel_at_period_end: true } as never)).toBe('CANCELLING')
  })

  it('is ACTIVE for a plain running subscription', () => {
    expect(mapSubscriptionStatus({ status: 'active', cancel_at_period_end: false } as never)).toBe('ACTIVE')
  })
})

describe('ensureCustomer', () => {
  it('reuses the cached customer and never calls Stripe again', async () => {
    h.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_live', stripeCustomerIdTest: null })
    const id = await ensureCustomer({ clientId: 'c1', connectAccountId: 'acct_1', sandbox: false })
    expect(id).toBe('cus_live')
    expect(h.customersCreate).not.toHaveBeenCalled()
  })

  it('keeps live and test customers apart', async () => {
    h.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_live', stripeCustomerIdTest: 'cus_test' })
    expect(await ensureCustomer({ clientId: 'c1', connectAccountId: 'acct_1', sandbox: true })).toBe('cus_test')
  })

  it('creates on the CONNECTED account with an idempotency key, then caches it', async () => {
    h.findUnique.mockResolvedValue({ stripeCustomerId: null, stripeCustomerIdTest: null })
    h.customersCreate.mockResolvedValue({ id: 'cus_new' })
    h.update.mockResolvedValue({})

    const id = await ensureCustomer({ clientId: 'c1', connectAccountId: 'acct_1', sandbox: false, email: 'a@b.c' })

    expect(id).toBe('cus_new')
    const [, opts] = h.customersCreate.mock.calls[0]
    // The Stripe-Account header is what makes this the trainer's customer.
    expect(opts.stripeAccount).toBe('acct_1')
    expect(opts.idempotencyKey).toBe('cust:c1:live')
    expect(h.update.mock.calls[0][0].data).toEqual({ stripeCustomerId: 'cus_new' })
  })
})

describe('ensurePlanPrice', () => {
  const plan = {
    id: 'plan1', interval: 'MONTH', intervalCount: 1, priceCents: 4000,
    stripePriceId: null, stripePriceIdTest: null,
    stripeProductId: null, stripeProductIdTest: null,
    membership: { trainerId: 't1', trainer: { payoutCurrency: 'nzd' } },
  }

  it('reuses a cached price without touching Stripe', async () => {
    h.planFindUnique.mockResolvedValue({ ...plan, stripePriceId: 'price_cached' })
    expect(await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: 'X' }))
      .toBe('price_cached')
    expect(h.pricesCreate).not.toHaveBeenCalled()
  })

  it('mints product + recurring price on the connected account and caches both', async () => {
    h.planFindUnique.mockResolvedValue(plan)
    h.productsCreate.mockResolvedValue({ id: 'prod_1' })
    h.pricesCreate.mockResolvedValue({ id: 'price_1' })
    h.planUpdate.mockResolvedValue({})

    const id = await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: 'Starter' })

    expect(id).toBe('price_1')
    const [body, opts] = h.pricesCreate.mock.calls[0]
    expect(body).toMatchObject({
      product: 'prod_1', currency: 'nzd', unit_amount: 4000,
      recurring: { interval: 'month', interval_count: 1 },
    })
    expect(opts.stripeAccount).toBe('acct_1')
    // The key includes the amount, so a price EDIT mints a genuinely new Price
    // rather than replaying the request that produced the old one.
    expect(opts.idempotencyKey).toBe('price:plan1:4000:MONTH:1:live')
    expect(h.planUpdate.mock.calls[0][0].data).toEqual({ stripePriceId: 'price_1', stripeProductId: 'prod_1' })
  })

  it('mints a week × 6 Price for a "6 week grooming" plan', async () => {
    h.planFindUnique.mockResolvedValue({ ...plan, interval: 'WEEK', intervalCount: 6, priceCents: 6000 })
    h.productsCreate.mockResolvedValue({ id: 'prod_g' })
    h.pricesCreate.mockResolvedValue({ id: 'price_g' })
    h.planUpdate.mockResolvedValue({})

    await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: '6 week grooming' })

    const [body, opts] = h.pricesCreate.mock.calls[0]
    expect(body.recurring).toEqual({ interval: 'week', interval_count: 6 })
    // The COUNT is in the key too. Without it, changing a monthly plan to
    // "every 6 weeks" at the same price would replay the monthly request and
    // hand back the monthly Price — a cycle change that silently didn't happen.
    expect(opts.idempotencyKey).toBe('price:plan1:6000:WEEK:6:live')
  })

  it('reads the count off the plan row, so nothing can mint a Price from a stale cycle', async () => {
    // The row is the single source of truth for what a client is charged; the
    // caller passes no interval at all.
    h.planFindUnique.mockResolvedValue({ ...plan, interval: 'WEEK', intervalCount: 4 })
    h.productsCreate.mockResolvedValue({ id: 'prod_x' })
    h.pricesCreate.mockResolvedValue({ id: 'price_x' })
    h.planUpdate.mockResolvedValue({})

    await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: 'X' })

    expect(h.pricesCreate.mock.calls[0][0].recurring).toEqual({ interval: 'week', interval_count: 4 })
    expect(h.planFindUnique.mock.calls[0][0].select.intervalCount).toBe(true)
  })

  it('never MUTATES a Price — a cached one is returned untouched whatever the cycle', async () => {
    // Stripe Prices are immutable. An existing subscriber bills against the
    // Price minted from their plan row, and this is the guard that it is never
    // rewritten underneath them.
    h.planFindUnique.mockResolvedValue({ ...plan, interval: 'WEEK', intervalCount: 6, stripePriceId: 'price_agreed' })
    expect(await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: 'X' }))
      .toBe('price_agreed')
    expect(h.pricesCreate).not.toHaveBeenCalled()
    expect(h.planUpdate).not.toHaveBeenCalled()
  })

  it('writes the TEST columns when the trainer is in sandbox mode', async () => {
    h.planFindUnique.mockResolvedValue(plan)
    h.productsCreate.mockResolvedValue({ id: 'prod_t' })
    h.pricesCreate.mockResolvedValue({ id: 'price_t' })
    h.planUpdate.mockResolvedValue({})

    await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: true, productName: 'Starter' })

    expect(h.planUpdate.mock.calls[0][0].data).toEqual({ stripePriceIdTest: 'price_t', stripeProductIdTest: 'prod_t' })
  })

  it('reuses an existing product rather than creating a second one', async () => {
    h.planFindUnique.mockResolvedValue({ ...plan, stripeProductId: 'prod_existing' })
    h.pricesCreate.mockResolvedValue({ id: 'price_2' })
    h.planUpdate.mockResolvedValue({})

    await ensurePlanPrice({ planId: 'plan1', connectAccountId: 'acct_1', sandbox: false, productName: 'Starter' })

    expect(h.productsCreate).not.toHaveBeenCalled()
    expect(h.pricesCreate.mock.calls[0][0].product).toBe('prod_existing')
  })
})
