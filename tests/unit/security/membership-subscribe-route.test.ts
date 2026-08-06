import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on the recurring-membership BUY path.
//
// This is money and it is multi-tenant, so the questions that matter are: can a
// client reach another trainer's plan, can they be signed up without agreeing,
// can they be charged twice for the same plan, and can a trainer who has not
// been switched on for recurring take a recurring payment at all.

const h = vi.hoisted(() => ({
  checkEligibility: vi.fn(),
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  trainerFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '1.2.3.4'),
  hasAddon: vi.fn(),
  isConnectConfigured: vi.fn(),
  createConnectCheckout: vi.fn(),
  ensureCustomer: vi.fn(),
  ensurePlanPrice: vi.fn(),
  createSubscriptionCheckout: vi.fn(),
  ensureConsent: vi.fn(),
  findLiveSubscription: vi.fn(),
  env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' },
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
// The eligibility RULE has its own suite (membership-eligibility.test.ts).
// Open by default here; the refusal is asserted in its own test below.
vi.mock('@/lib/membership-eligibility', () => ({
  checkEligibility: h.checkEligibility,
  describeMissing: vi.fn(async () => ['Bronze Recall']),
}))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
// PARTIAL mock: the Stripe-touching calls are stubbed, but the pure helpers
// (intervalLabel, addCycles) stay real because the consent copy is built from
// them and this suite asserts the exact stored wording.
vi.mock('@/lib/connect-subscriptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/connect-subscriptions')>()),
  ensureCustomer: h.ensureCustomer,
  ensurePlanPrice: h.ensurePlanPrice,
  createSubscriptionCheckout: h.createSubscriptionCheckout,
}))
vi.mock('@/lib/membership-billing', async () => {
  const copy = await import('@/lib/membership-consent-copy')
  return {
    ensureConsent: h.ensureConsent,
    findLiveSubscription: h.findLiveSubscription,
    // The real copy builder — the point is that the STORED text is server-derived.
    describePlanCommitment: copy.describePlanCommitment,
  }
})
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    membership: { findFirst: h.membershipFindFirst },
    trainerProfile: { findUnique: h.trainerFindUnique },
  },
}))

import { POST } from '@/app/api/my/memberships/[membershipId]/buy/route'

const PLAN = { id: 'plan1', interval: 'MONTH', intervalCount: 1, priceCents: 4000, minTermCount: 0, earlyTermFeeCents: null }

function req(body: unknown = { consent: true }) {
  return new Request('https://app.pupmanager.com/api/my/memberships/m1/buy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (membershipId = 'm1') => ({ params: Promise.resolve({ membershipId }) })

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.enforceRateLimit.mockResolvedValue(null)
  h.hasAddon.mockResolvedValue(true)
  h.isConnectConfigured.mockReturnValue(true)
  h.checkEligibility.mockResolvedValue({ eligible: true, lockedReason: null, missing: [] })
  h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: false })
  h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1', user: { email: 'a@b.c', name: 'Sarah' } })
  h.membershipFindFirst.mockResolvedValue({
    id: 'm1', name: 'Starter', priceCents: 0, cadence: 'RECURRING', interval: 'MONTH',
    eligibility: 'PUBLIC', plans: [PLAN],
  })
  h.trainerFindUnique.mockResolvedValue({
    acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1',
    payoutCurrency: 'nzd', sandboxBilling: true, businessName: 'E2E Dog School',
    recurringPaymentsEnabled: true,
  })
  h.findLiveSubscription.mockResolvedValue(null)
  h.ensureConsent.mockResolvedValue({ id: 'con1' })
  h.ensureCustomer.mockResolvedValue('cus_1')
  h.ensurePlanPrice.mockResolvedValue('price_1')
  h.createSubscriptionCheckout.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/checkout' })
})

describe('eligibility', () => {
  it('403s a package this client has not earned, before any Stripe call', async () => {
    // The storefront already greys the card out. This is the same rule applied
    // where it actually binds: a POST straight at the route, which is the only
    // version of the ladder that cannot be walked around.
    h.checkEligibility.mockResolvedValue({ eligible: false, lockedReason: 'ACHIEVEMENT', missing: ['a1'] })

    const res = await POST(req(), params())

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ lockedReason: 'ACHIEVEMENT' })
    expect(h.ensureConsent).not.toHaveBeenCalled()
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('403s an invite-only package with no invitation on file', async () => {
    h.checkEligibility.mockResolvedValue({ eligible: false, lockedReason: 'INVITE_ONLY', missing: [] })

    const res = await POST(req(), params())

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('invitation') })
  })

  it('lets an eligible client straight through', async () => {
    const res = await POST(req(), params())
    expect(res.status).toBe(201)
  })
})

describe('tenancy', () => {
  it('404s a membership belonging to another trainer, and scopes the lookup', async () => {
    h.membershipFindFirst.mockResolvedValue(null)
    const res = await POST(req(), params('other-trainers-membership'))
    expect(res.status).toBe(404)
    // 404 not 403 — a 403 would confirm the membership exists.
    expect(h.membershipFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'other-trainers-membership', trainerId: 't1', published: true,
    })
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('never sells an unpublished membership', async () => {
    expect(h.membershipFindFirst.mock.calls.length).toBe(0)
    await POST(req(), params())
    expect(h.membershipFindFirst.mock.calls[0][0].where.published).toBe(true)
  })

  it('refuses a plan id that is not on this membership', async () => {
    // The plan is resolved from the membership's OWN plan list, so a foreign
    // plan id can never be substituted in.
    const res = await POST(req({ consent: true, planId: 'someone-elses-plan' }), params())
    expect(res.status).toBe(409)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('401s with no client context and 403s in trainer preview mode', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await POST(req(), params())).status).toBe(401)

    h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: true })
    expect((await POST(req(), params())).status).toBe(403)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('404s when the trainer’s memberships add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)
    expect((await POST(req(), params())).status).toBe(404)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('honours the rate limiter before doing anything', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await POST(req(), params())).status).toBe(429)
    expect(h.membershipFindFirst).not.toHaveBeenCalled()
  })
})

describe('the recurring rollout gate', () => {
  it('refuses when the trainer is not switched on for recurring payments', async () => {
    // The env allowlist is gone; this column IS the allowlist.
    h.trainerFindUnique.mockResolvedValue({
      acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1',
      payoutCurrency: 'nzd', sandboxBilling: true, businessName: 'X', recurringPaymentsEnabled: false,
    })
    const res = await POST(req(), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('set it up') })
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('refuses when the trainer has no connected account', async () => {
    h.trainerFindUnique.mockResolvedValue({
      acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: null,
      payoutCurrency: 'nzd', sandboxBilling: true, businessName: 'X', recurringPaymentsEnabled: true,
    })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })
})

describe('consent', () => {
  it('refuses to start a subscription without an explicit tick', async () => {
    const res = await POST(req({ consent: false }), params())
    expect(res.status).toBe(400)
    expect(h.ensureConsent).not.toHaveBeenCalled()
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('refuses when the body is missing entirely', async () => {
    const bare = new Request('https://app.pupmanager.com/api/my/memberships/m1/buy', { method: 'POST' })
    expect((await POST(bare, params())).status).toBe(400)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('stores SERVER-derived consent text, not anything the browser sent', async () => {
    await POST(req({ consent: true, consentText: 'I agree to nothing at all' }), params())
    const stored = h.ensureConsent.mock.calls[0][0]
    expect(stored.consentText).toBe('I agree E2E Dog School can charge my card $40.00 every month until I cancel.')
    expect(stored).toMatchObject({ clientId: 'c1', membershipId: 'm1', planId: 'plan1', priceCents: 4000, ipAddress: '1.2.3.4' })
  })

  it('writes the consent BEFORE calling Stripe', async () => {
    await POST(req(), params())
    expect(h.ensureConsent.mock.invocationCallOrder[0])
      .toBeLessThan(h.createSubscriptionCheckout.mock.invocationCallOrder[0])
  })

  it('agrees to the cycle the PLAN actually bills on — "every 6 weeks"', async () => {
    // The failure this stops: a count honoured when the Stripe Price is minted
    // and missing from the sentence, so the client ticks a box saying "every
    // week" and their card is charged every six.
    h.membershipFindFirst.mockResolvedValue({
      id: 'm1', name: '6 week grooming', priceCents: 0, cadence: 'RECURRING', interval: 'MONTH',
      eligibility: 'PUBLIC',
      plans: [{ id: 'plan6', interval: 'WEEK', intervalCount: 6, priceCents: 6000, minTermCount: 0, earlyTermFeeCents: null }],
    })

    await POST(req(), params())

    const stored = h.ensureConsent.mock.calls[0][0]
    expect(stored.consentText)
      .toBe('I agree E2E Dog School can charge my card $60.00 every 6 weeks until I cancel.')
    // The cycle is snapshotted on the consent row too, so the record of what
    // they agreed to stands on its own if the plan is edited afterwards.
    expect(stored).toMatchObject({ interval: 'WEEK', intervalCount: 6 })
  })

  it('leaves a plain weekly plan saying "every week", not "every 1 week"', async () => {
    h.membershipFindFirst.mockResolvedValue({
      id: 'm1', name: 'Weekly', priceCents: 0, cadence: 'RECURRING', interval: 'WEEK',
      eligibility: 'PUBLIC',
      plans: [{ id: 'planw', interval: 'WEEK', intervalCount: 1, priceCents: 2500, minTermCount: 0, earlyTermFeeCents: null }],
    })
    await POST(req(), params())
    expect(h.ensureConsent.mock.calls[0][0].consentText)
      .toBe('I agree E2E Dog School can charge my card $25.00 every week until I cancel.')
  })
})

describe('double-subscribe', () => {
  it('refuses when the client already has a live subscription to this membership', async () => {
    h.findLiveSubscription.mockResolvedValue({ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1' })
    const res = await POST(req(), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('already on this plan') })
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('anchors the Stripe idempotency key on the consent id', async () => {
    // Two taps reuse one consent, so both produce this same key and Stripe
    // collapses them into ONE subscription.
    await POST(req(), params())
    expect(h.createSubscriptionCheckout.mock.calls[0][0].idempotencyKey).toBe('subcheckout:con1')
  })
})

describe('the happy path', () => {
  it('creates the subscription on the trainer’s connected account', async () => {
    const res = await POST(req(), params())
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, mode: 'subscription', url: 'https://stripe/checkout' })

    const args = h.createSubscriptionCheckout.mock.calls[0][0]
    expect(args).toMatchObject({ connectAccountId: 'acct_1', sandbox: true, customerId: 'cus_1', priceId: 'price_1', currency: 'nzd' })
    // Metadata is how every later invoice.* webhook resolves back to us.
    expect(args.subscriptionMetadata).toEqual({
      membershipId: 'm1', trainerId: 't1', clientId: 'c1', planId: 'plan1', consentId: 'con1',
    })
  })

  it('does NOT add a processing-fee surcharge line to a recurring plan', async () => {
    // A surcharge LINE would only apply to the first cycle, so the trainer would
    // silently under-recover from cycle two. The one-off path is untouched.
    await POST(req(), params())
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('still sends a ONE_OFF membership down the original checkout path', async () => {
    h.membershipFindFirst.mockResolvedValue({
      id: 'm1', name: 'Starter', priceCents: 12000, cadence: 'ONE_OFF', interval: null, plans: [],
    })
    h.createConnectCheckout.mockResolvedValue({ url: 'https://stripe/oneoff', paymentId: 'pay1' })

    const res = await POST(req({ consent: false }), params())

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ mode: 'payment' })
    // A one-off needs no mandate, so the consent gate must not block it.
    expect(h.createConnectCheckout).toHaveBeenCalled()
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })

  it('refuses a recurring membership whose plan has no price', async () => {
    h.membershipFindFirst.mockResolvedValue({
      id: 'm1', name: 'Starter', priceCents: 0, cadence: 'RECURRING', interval: 'MONTH',
      plans: [{ ...PLAN, priceCents: 0 }],
    })
    expect((await POST(req(), params())).status).toBe(409)
  })

  it('refuses a recurring membership with no plans at all', async () => {
    h.membershipFindFirst.mockResolvedValue({
      id: 'm1', name: 'Starter', priceCents: 4000, cadence: 'RECURRING', interval: 'MONTH', plans: [],
    })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createSubscriptionCheckout).not.toHaveBeenCalled()
  })
})
