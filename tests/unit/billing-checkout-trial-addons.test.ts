import { describe, it, expect, vi, beforeEach } from 'vitest'

// A trainer can now switch a PAID add-on on during their free trial (see
// /api/addons — it writes an active TrainerAddon row with no Stripe line item).
// The promise made to them is "you get invoiced when the trial is up", and this
// route is the only place that promise can be kept: it is where the subscription
// is created, with the trainer's REMAINING trial days, so the first invoice
// lands the day the trial ends and carries the add-on.
//
// The thing that must not go wrong is billing it twice. Stripe will happily put
// the same price on a subscription two times and charge for both, and there are
// two ways to get there: the form ticks an add-on that is already on, or a
// client posts the same id twice. Both are pinned below.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getTrainerContext: vi.fn(),
  planFindUnique: vi.fn(),
  itemFindMany: vi.fn(),
  trainerFindUnique: vi.fn(),
  trainerUpdate: vi.fn(),
  getUnbilledPaidAddons: vi.fn(),
  sessionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  customersCreate: vi.fn(),
  customersUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: () => null }))
vi.mock('@/lib/founder', () => ({ isFounderEligible: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/country', () => ({ countryToISO: () => 'NZ' }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com', STRIPE_FOUNDER_COUPON_ID: null } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscriptionPlan: { findUnique: h.planFindUnique },
    billingItem: { findMany: h.itemFindMany },
    trainerProfile: { findUnique: h.trainerFindUnique, update: h.trainerUpdate },
  },
}))
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  stripeFor: () => ({
    subscriptions: { list: h.subscriptionsList },
    customers: { create: h.customersCreate, update: h.customersUpdate },
    checkout: { sessions: { create: h.sessionsCreate } },
  }),
}))
vi.mock('@/lib/billing', () => ({
  // Every row in this suite carries its own price id, so resolution is trivial
  // and the test is about WHICH items reach Stripe, not how prices are looked up.
  resolvePriceId: (item: { stripePriceId: string | null }) => item.stripePriceId ?? null,
  getUnbilledPaidAddons: h.getUnbilledPaidAddons,
}))

import { POST } from '@/app/api/billing/checkout/route'

const DAY = 24 * 60 * 60 * 1000

const body = (over: Record<string, unknown> = {}) => ({
  planId: 'plan_core',
  currency: 'NZD',
  seatCount: 1,
  addons: [],
  businessName: 'Pup Co',
  phone: '021555000',
  addressLine1: '1 Test St',
  addressCity: 'Auckland',
  addressPostcode: '1010',
  addressCountry: 'New Zealand',
  ...over,
})

const req = (over: Record<string, unknown> = {}) =>
  new Request('https://app.pupmanager.com/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(body(over)),
  })

const ADDON_ROW = (id: string) => ({
  id,
  kind: 'ADDON' as const,
  stripePriceId: `price_${id}`,
  stripePriceIdsByCurrency: {},
  stripePriceIdTest: null,
  stripePriceIdsByCurrencyTest: {},
})

/** The prices Stripe was actually asked to put on the subscription. */
function lineItemPrices(): string[] {
  return h.sessionsCreate.mock.calls[0][0].line_items.map((l: { price: string }) => l.price)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: 't1' } })
  h.getTrainerContext.mockResolvedValue({ companyId: 't1', role: 'OWNER', permissions: null })
  h.trainerFindUnique.mockResolvedValue({ sandboxBilling: false })
  h.planFindUnique.mockResolvedValue({
    id: 'plan_core',
    name: 'Core software',
    isActive: true,
    stripePriceId: 'price_core',
    stripePriceIdsByCurrency: {},
    stripePriceIdTest: null,
    stripePriceIdsByCurrencyTest: {},
  })
  h.itemFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map(ADDON_ROW),
  )
  h.trainerUpdate.mockResolvedValue({
    stripeCustomerId: null,
    isFounder: false,
    // Five days of trial left — the whole point: the subscription starts trialing
    // and the add-on's first charge lands when it converts.
    trialEndsAt: new Date(Date.now() + 5 * DAY),
    businessName: 'Pup Co',
    phone: '021555000',
    addressLine1: '1 Test St',
    addressLine2: null,
    addressCity: 'Auckland',
    addressRegion: null,
    addressPostcode: '1010',
    addressCountry: 'New Zealand',
    user: { email: 'a@b.com', name: 'A' },
  })
  h.customersCreate.mockResolvedValue({ id: 'cus_1' })
  h.subscriptionsList.mockResolvedValue({ data: [] })
  h.sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
  h.getUnbilledPaidAddons.mockResolvedValue([])
})

describe('POST /api/billing/checkout — add-ons switched on during the trial', () => {
  it('carries an add-on the trainer turned on during the trial onto the subscription', async () => {
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing'])

    const res = await POST(req({ addons: [] }))

    expect(res.status).toBe(200)
    expect(lineItemPrices()).toEqual(['price_core', 'price_marketing'])
  })

  it('bills an already-on add-on ONCE when the form ticks it as well', async () => {
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing'])

    await POST(req({ addons: ['marketing'] }))

    const prices = lineItemPrices()
    expect(prices.filter(p => p === 'price_marketing')).toHaveLength(1)
    expect(prices).toEqual(['price_core', 'price_marketing'])
  })

  it('bills once even if the client posts the same add-on twice', async () => {
    await POST(req({ addons: ['marketing', 'marketing'] }))

    expect(lineItemPrices()).toEqual(['price_core', 'price_marketing'])
  })

  it('merges trial add-ons with newly ticked ones, one line each', async () => {
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing', 'routeplanner'])

    await POST(req({ addons: ['routeplanner', 'leadmagnets'] }))

    const prices = lineItemPrices()
    expect(prices).toHaveLength(4)
    expect(new Set(prices)).toEqual(
      new Set(['price_core', 'price_marketing', 'price_routeplanner', 'price_leadmagnets']),
    )
  })

  it('does not carry an add-on the trainer switched off before subscribing', async () => {
    // Turning it off wrote active:false, so it isn't in the unbilled set at all —
    // and it must not be resurrected by checkout.
    h.getUnbilledPaidAddons.mockResolvedValue([])

    await POST(req({ addons: [] }))

    expect(lineItemPrices()).toEqual(['price_core'])
  })

  it('starts the subscription with the remaining trial days, so the add-on bills at conversion', async () => {
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing'])

    await POST(req())

    const args = h.sessionsCreate.mock.calls[0][0]
    expect(args.subscription_data.trial_period_days).toBe(5)
    expect(args.subscription_data.metadata.addons).toBe('marketing')
  })

  it('records each billed add-on once in metadata', async () => {
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing'])

    await POST(req({ addons: ['marketing', 'routeplanner'] }))

    const listed = h.sessionsCreate.mock.calls[0][0].metadata.addons.split(',')
    expect(listed.sort()).toEqual(['marketing', 'routeplanner'])
  })

  it('a trial add-on with no wired price does not block the trainer from subscribing', async () => {
    // They never asked for it on this screen — refusing checkout over wiring they
    // can't see would keep a paying customer from paying us at all.
    h.getUnbilledPaidAddons.mockResolvedValue(['marketing'])
    h.itemFindMany.mockResolvedValue([{ ...ADDON_ROW('marketing'), stripePriceId: null }])

    const res = await POST(req({ addons: [] }))

    expect(res.status).toBe(200)
    expect(lineItemPrices()).toEqual(['price_core'])
  })

  it('an add-on ticked on this screen with no wired price is still a hard refusal', async () => {
    h.itemFindMany.mockResolvedValue([{ ...ADDON_ROW('marketing'), stripePriceId: null }])

    const res = await POST(req({ addons: ['marketing'] }))

    expect(res.status).toBe(409)
    expect(h.sessionsCreate).not.toHaveBeenCalled()
  })
})
