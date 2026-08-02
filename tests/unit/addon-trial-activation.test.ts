import { describe, it, expect, vi, beforeEach } from 'vitest'

// A trainer on a FREE TRIAL has no Stripe subscription, and POST /api/addons
// used to answer every paid add-on with "Subscribe to your plan to add extras."
// — so the only way to try a paid extra was to end your own trial and start
// paying for it. Karl's call: "people can turn this on — not on by default —
// but they can turn it on, and then they get invoiced when the trial is up."
//
// This suite pins the exact boundary of that door, because it is a door into
// paid features:
//   • trial still running + no subscription  → switches on locally, no Stripe
//   • trial EXPIRED  + no subscription       → still refused (the old error)
//   • no trial at all                        → still refused
//   • already subscribed                     → still the real Stripe path
// and that the row it writes carries NO stripeSubscriptionItemId, which is what
// keeps the webhook from either sweeping it away or double-billing it later.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  billingItemUpsert: vi.fn(),
  isStripeConfigured: vi.fn(),
  stripeFor: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { upsert: h.upsert },
    trainerProfile: { findUnique: h.findUnique },
    billingItem: { upsert: h.billingItemUpsert },
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripeFor: h.stripeFor,
  isStripeConfigured: h.isStripeConfigured,
}))
vi.mock('@/lib/billing', () => ({ resolvePriceId: vi.fn(), loadPriceIndex: vi.fn() }))

import { POST } from '@/app/api/addons/route'

const DAY = 24 * 60 * 60 * 1000
const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/addons', { method: 'POST', body: JSON.stringify(body) })

// 'marketing' is one of the paid add-ons — the ones that used to be unreachable
// on a trial.
const PAID = 'marketing'

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.upsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
  // Stripe IS configured — so a refusal below is about the trial rule, not about
  // billing being switched off in this environment.
  h.isStripeConfigured.mockReturnValue(true)
})

const trainer = (over: Record<string, unknown> = {}) => ({
  stripeSubscriptionId: null,
  sandboxBilling: false,
  trialEndsAt: null,
  ...over,
})

describe('POST /api/addons — a paid add-on during the free trial', () => {
  it('switches on with no Stripe call while the trial is still running', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() + 5 * DAY) }))

    const res = await POST(req({ itemId: PAID, active: true }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, itemId: PAID, active: true, billsAtTrialEnd: true })
    expect(h.stripeFor).not.toHaveBeenCalled()
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.upsert.mock.calls[0][0].create).toMatchObject({ trainerId: 'co_1', itemId: PAID, active: true })
  })

  it('leaves stripeSubscriptionItemId unset, so the webhook can adopt the row instead of adding a second one', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() + 5 * DAY) }))

    await POST(req({ itemId: PAID, active: true }))

    const call = h.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ trainerId_itemId: { trainerId: 'co_1', itemId: PAID } })
    expect(call.create.stripeSubscriptionItemId).toBeUndefined()
    expect(call.update.stripeSubscriptionItemId).toBeUndefined()
  })

  it('switches back OFF during the trial, so it is never carried to the subscription', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() + 5 * DAY) }))

    const res = await POST(req({ itemId: PAID, active: false }))

    expect(res.status).toBe(200)
    expect(h.upsert.mock.calls[0][0].update).toMatchObject({ active: false })
    expect(h.stripeFor).not.toHaveBeenCalled()
  })

  it('self-heals the BillingItem first, exactly as the free path does', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() + 5 * DAY) }))

    await POST(req({ itemId: PAID, active: true }))

    expect(h.billingItemUpsert).toHaveBeenCalledTimes(1)
    expect(h.billingItemUpsert.mock.calls[0][0].where).toEqual({ id: PAID })
  })
})

describe('POST /api/addons — the door stays shut everywhere else', () => {
  it('refuses an EXPIRED trial with no subscription (paid extras must not be free forever)', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() - DAY) }))

    const res = await POST(req({ itemId: PAID, active: true }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ needsSubscription: true })
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('refuses a trainer who never had a trial and has no subscription', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: null }))

    const res = await POST(req({ itemId: PAID, active: true }))

    expect(res.status).toBe(409)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a trial that ended one second ago is expired, not "still running"', async () => {
    h.findUnique.mockResolvedValue(trainer({ trialEndsAt: new Date(Date.now() - 1000) }))

    const res = await POST(req({ itemId: PAID, active: true }))

    expect(res.status).toBe(409)
  })

  it('a subscribed trainer inside a carried-over trial still goes down the real Stripe path', async () => {
    // They have a subscription, so the add-on belongs on it as a line item —
    // taking the local path would give them the feature without ever billing it.
    h.findUnique.mockResolvedValue(
      trainer({ stripeSubscriptionId: 'sub_1', trialEndsAt: new Date(Date.now() + 5 * DAY) }),
    )
    h.stripeFor.mockReturnValue({
      subscriptions: { retrieve: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'canceled', items: { data: [] } }) },
    })

    const res = await POST(req({ itemId: PAID, active: true }))

    // Reaching the cancelled-subscription guard proves it took the Stripe path.
    expect(h.stripeFor).toHaveBeenCalled()
    expect(res.status).toBe(409)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('still comps a sandbox/demo account, trial or not', async () => {
    h.findUnique.mockResolvedValue(trainer({ sandboxBilling: true, trialEndsAt: null }))

    const res = await POST(req({ itemId: PAID, active: true }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ comped: true })
    expect(h.stripeFor).not.toHaveBeenCalled()
  })
})
