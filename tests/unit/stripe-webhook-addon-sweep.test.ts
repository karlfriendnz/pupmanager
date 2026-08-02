import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Stripe webhook's reconciliation sweep switches OFF any add-on that is no
// longer a line item on the subscription. It is the most likely explanation for
// a feature being off that a customer swears they never turned off — a failed
// payment, a plan change, an edit in the Stripe Dashboard — and until now it was
// completely silent: the row simply flipped, with an updatedAt and nothing else.
//
// So the sweep writes an audit entry per row it deactivates, attributed to
// `system` (nobody did this) with reason `webhook_sweep`. This suite proves it
// writes one when it sweeps, that it names the right add-on, and that a routine
// event with nothing to sweep stays quiet.
const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  subscriptionsList: vi.fn(),
  addonFindMany: vi.fn(),
  addonUpsert: vi.fn(),
  addonUpdateMany: vi.fn(),
  profileFindUnique: vi.fn(),
  profileFindFirst: vi.fn(),
  profileUpdate: vi.fn(),
  auditCreate: vi.fn(),
  loadPriceIndex: vi.fn(),
  notifyConversion: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { findMany: h.addonFindMany, upsert: h.addonUpsert, updateMany: h.addonUpdateMany },
    trainerProfile: { findUnique: h.profileFindUnique, findFirst: h.profileFindFirst, update: h.profileUpdate },
    auditLog: { create: h.auditCreate },
  },
}))
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  stripeFor: () => ({
    webhooks: { constructEvent: h.constructEvent },
    subscriptions: { list: h.subscriptionsList },
  }),
}))
vi.mock('@/lib/env', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_WEBHOOK_SECRET_TEST: undefined } }))
vi.mock('@/lib/billing', () => ({ loadPriceIndex: h.loadPriceIndex }))
vi.mock('@/lib/conversion-alert', () => ({ notifyConversion: h.notifyConversion }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))

import { POST } from '@/app/api/webhooks/stripe/route'

const event = (sub: Record<string, unknown>) => ({
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_live', status: 'active', metadata: { trainerId: 't1' }, customer: 'cus_1', items: { data: [] }, ...sub } },
})

const req = () =>
  new Request('https://app.pupmanager.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=whatever' },
    body: '{}',
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.loadPriceIndex.mockResolvedValue(new Map())
  h.profileFindUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_live', subscriptionStatus: 'ACTIVE', stripeCustomerId: 'cus_1' })
  h.profileUpdate.mockResolvedValue({})
  h.addonUpdateMany.mockResolvedValue({ count: 0 })
  h.addonFindMany.mockResolvedValue([])
  h.auditCreate.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the webhook sweep no longer switches an add-on off in silence', () => {
  it('records every row it deactivates, as nobody', async () => {
    h.constructEvent.mockReturnValue(event({}))
    // Two paid add-ons still marked on locally, neither present on the sub.
    h.addonFindMany.mockResolvedValue([{ itemId: 'achievements' }, { itemId: 'shop' }])

    const res = await POST(req())
    expect(res.status).toBe(200)

    expect(h.auditCreate).toHaveBeenCalledTimes(2)
    const metas = h.auditCreate.mock.calls.map(c => c[0].data)
    expect(metas.map(m => m.targetId).sort()).toEqual(['achievements', 'shop'])
    for (const m of metas) {
      expect(m).toMatchObject({ action: 'BILLING_CHANGED', companyId: 't1', targetType: 'addon', actorUserId: null })
      expect(m.meta).toMatchObject({ active: false, via: 'system', outcome: 'applied', reason: 'webhook_sweep' })
    }
  })

  it('reads the rows BEFORE flipping them — after the updateMany there is nothing left to name', async () => {
    h.constructEvent.mockReturnValue(event({}))
    h.addonFindMany.mockResolvedValue([{ itemId: 'achievements' }])
    await POST(req())

    const findOrder = h.addonFindMany.mock.invocationCallOrder[0]
    const updateOrder = h.addonUpdateMany.mock.invocationCallOrder[0]
    expect(findOrder).toBeLessThan(updateOrder)
    // Same filter both times, or the entry would name a row that never moved.
    expect(h.addonFindMany.mock.calls[0][0].where).toEqual(h.addonUpdateMany.mock.calls[0][0].where)
  })

  it('still refuses to sweep comps and locally-enabled rows', async () => {
    h.constructEvent.mockReturnValue(event({}))
    await POST(req())
    expect(h.addonUpdateMany.mock.calls[0][0].where).toMatchObject({
      grantedByAdmin: false,
      stripeSubscriptionItemId: { not: null },
    })
  })

  it('says nothing when there is nothing to sweep', async () => {
    h.constructEvent.mockReturnValue(event({}))
    h.addonFindMany.mockResolvedValue([])
    await POST(req())
    expect(h.auditCreate).not.toHaveBeenCalled()
  })
})
