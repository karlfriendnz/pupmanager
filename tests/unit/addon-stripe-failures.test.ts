import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── The Mersea Mutts bug, 2026-08-02 ────────────────────────────────────────
//
// A paying UK customer could not switch an add-on back on. All the app said was
// "Could not change this add-on. Please try again." The production log said:
//
//   Error: No such subscription: 'sub_1Twz2yP6hzHIfGfrxlYFHCdS'
//
// POST /api/addons called subscriptions.retrieve with no try/catch, so Stripe's
// throw became a 500, and the grid's only fallback sentence was the one piece of
// advice that could never work: a `resource_missing` subscription does not come
// back, so "try again" fails identically forever.
//
// This suite pins the shape of every Stripe failure the toggle can hit: which
// status, which machine reason, whether it's permanent, and — for the one that
// actually happened — that the sentence a trainer reads never says "try again".
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  billingItemUpsert: vi.fn(),
  billingItemFindUnique: vi.fn(),
  isStripeConfigured: vi.fn(),
  stripeFor: vi.fn(),
  resolvePriceId: vi.fn(),
  loadPriceIndex: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { upsert: h.upsert },
    trainerProfile: { findUnique: h.findUnique },
    billingItem: { upsert: h.billingItemUpsert, findUnique: h.billingItemFindUnique },
  },
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: h.isStripeConfigured }))
vi.mock('@/lib/billing', () => ({ resolvePriceId: h.resolvePriceId, loadPriceIndex: h.loadPriceIndex }))

import { POST } from '@/app/api/addons/route'
import { apiErrorMessage } from '@/lib/api-error-message'

// The real subscription id from the production log, kept verbatim: the message
// a trainer reads names the subscription, and that is what makes a support
// conversation about it possible at all.
const DEAD_SUB = 'sub_1Twz2yP6hzHIfGfrxlYFHCdS'
const PAID = 'achievements' // the add-on Mersea Mutts could not switch back on

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/addons', { method: 'POST', body: JSON.stringify(body) })

/** A Stripe SDK error, shaped the way the library actually throws them. */
function stripeError(fields: { type: string; code?: string; message: string }) {
  return Object.assign(new Error(fields.message), fields)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.getTrainerContext.mockResolvedValue({ userId: 'u_1', companyId: 'co_1', role: 'OWNER', permissions: null })
  h.upsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
  h.billingItemFindUnique.mockResolvedValue({ stripePriceId: 'price_live', stripePriceIdsByCurrency: null, stripePriceIdTest: null, stripePriceIdsByCurrencyTest: null })
  h.resolvePriceId.mockReturnValue('price_live')
  h.loadPriceIndex.mockResolvedValue(new Map())
  h.isStripeConfigured.mockReturnValue(true)
  // A real, subscribed, non-sandbox business — exactly Mersea Mutts' row.
  h.findUnique.mockResolvedValue({ stripeSubscriptionId: DEAD_SUB, sandboxBilling: false, trialEndsAt: null })
  h.stripeFor.mockReturnValue({ subscriptions: { retrieve: h.retrieve, update: h.update } })
  h.retrieve.mockResolvedValue({
    id: DEAD_SUB,
    status: 'active',
    currency: 'gbp',
    items: { data: [] },
  })
  h.update.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/addons — a subscription that does not exist in Stripe', () => {
  beforeEach(() => {
    h.retrieve.mockRejectedValue(
      stripeError({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        message: `No such subscription: '${DEAD_SUB}'`,
      }),
    )
  })

  it('does not 500 — the throw is caught and answered', async () => {
    const res = await POST(req({ itemId: PAID, active: true }))
    expect(res.status).toBe(409)
  })

  it('names the fault in a sentence, and never says "try again"', async () => {
    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()

    expect(typeof body.error).toBe('string')
    expect(body.error.toLowerCase()).not.toContain('try again')
    expect(body.error).toContain(DEAD_SUB)
    expect(body.error.toLowerCase()).toContain('support')
  })

  it('is machine-readable as permanent, so the UI can stop offering a retry', async () => {
    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(body.reason).toBe('subscription_missing')
    expect(body.permanent).toBe(true)
  })

  it('does NOT flag needsSubscription — a second subscription is not the fix', async () => {
    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(body.needsSubscription).toBeUndefined()
  })

  it('writes nothing: the add-on must not switch on when Stripe never charged for it', async () => {
    await POST(req({ itemId: PAID, active: true }))
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('leaves the real cause in the server log with the trainer, add-on and code', async () => {
    await POST(req({ itemId: PAID, active: true }))
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(c => String(c[0]))
      .join('\n')
    expect(logged).toContain('co_1')
    expect(logged).toContain(PAID)
    expect(logged).toContain(DEAD_SUB)
    expect(logged).toContain('resource_missing')
  })

  it('answers the same way when the failure lands on the UPDATE instead', async () => {
    h.retrieve.mockResolvedValue({ id: DEAD_SUB, status: 'active', currency: 'gbp', items: { data: [] } })
    h.update.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'resource_missing', message: `No such subscription: '${DEAD_SUB}'` }),
    )

    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.reason).toBe('subscription_missing')
    // The local row must not claim the add-on is on when Stripe refused it.
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/addons — the other ways Stripe can fail', () => {
  it('a connection failure IS transient, and is the one place "try again" is honest', async () => {
    h.retrieve.mockRejectedValue(stripeError({ type: 'StripeConnectionError', message: 'An error occurred with our connection to Stripe.' }))

    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.reason).toBe('stripe_unavailable')
    expect(body.permanent).toBe(false)
    expect(body.error.toLowerCase()).toContain('try again')
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a refusal from Stripe is passed through in Stripe’s own words', async () => {
    h.update.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'price_not_found', message: 'No such price: \'price_live\'' }),
    )

    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.reason).toBe('stripe_rejected')
    expect(body.permanent).toBe(true)
    expect(body.error).toContain('No such price')
  })

  it('a failed price-index load stops the change rather than guessing at it', async () => {
    // The index decides whether we ADD a line or DELETE one. No answer must not
    // be read as "there is no line" — that would add a second paid line item.
    h.loadPriceIndex.mockRejectedValue(new Error('connection terminated unexpectedly'))

    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.reason).toBe('price_lookup_failed')
    expect(h.update).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a cancelled subscription still says so, and still points at Billing', async () => {
    h.retrieve.mockResolvedValue({ id: DEAD_SUB, status: 'canceled', currency: 'gbp', items: { data: [] } })

    const res = await POST(req({ itemId: PAID, active: true }))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.reason).toBe('subscription_inactive')
    expect(body.needsSubscription).toBe(true)
  })

  it('the happy path is untouched: the line goes on and the row is written', async () => {
    const res = await POST(req({ itemId: PAID, active: true }))
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith(DEAD_SUB, expect.objectContaining({
      items: [{ price: 'price_live', quantity: 1 }],
      proration_behavior: 'create_prorations',
    }))
    expect(h.upsert.mock.calls[0][0].update).toMatchObject({ active: true })
  })
})

describe('apiErrorMessage — what the trainer is shown', () => {
  it('uses the server’s sentence when there is one', () => {
    expect(apiErrorMessage({ error: 'Your subscription is not active.' }, 409)).toBe('Your subscription is not active.')
  })

  it('unpacks a Zod flatten() object instead of falling through to "try again"', () => {
    // This is the silent case: `typeof body.error === 'string'` is false for an
    // object, so a 400 that said exactly what was wrong showed the generic line.
    const flattened = { formErrors: [], fieldErrors: { itemId: ['Required'], active: ['Expected boolean'] } }
    const msg = apiErrorMessage({ error: flattened }, 400, { fallback: 'nope' })
    expect(msg).toContain('Required')
    expect(msg).toContain('Expected boolean')
    expect(msg).not.toBe('nope')
  })

  it('never renders an object as "[object Object]"', () => {
    const msg = apiErrorMessage({ error: { fieldErrors: {}, formErrors: [] } }, 400, { fallback: 'fallback line' })
    expect(msg).toBe('fallback line')
  })

  it('a 500 with no error admits we don’t know, rather than promising a retry', () => {
    const msg = apiErrorMessage({}, 500)
    expect(msg.toLowerCase()).not.toContain('try again')
    expect(msg.toLowerCase()).toContain('support')
  })

  it('a 4xx with no error uses the caller’s own fallback', () => {
    expect(apiErrorMessage({}, 403, { fallback: 'Could not change this add-on. Please try again.' }))
      .toBe('Could not change this add-on. Please try again.')
  })
})
