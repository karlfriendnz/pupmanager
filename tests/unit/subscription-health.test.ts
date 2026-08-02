import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mersea Mutts' TrainerProfile named a subscription that does not exist in the
// live Stripe account. Nothing in the product showed that: the plan rendered,
// the add-ons page offered paid extras, and the truth was only discoverable by
// reading a Vercel log after they complained — while, quite possibly, nobody was
// charging them at all. checkSubscriptionHealth is the one question that makes
// that state visible on the admin page.
const h = vi.hoisted(() => ({ retrieve: vi.fn(), isStripeConfigured: vi.fn() }))

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: h.isStripeConfigured,
  stripeFor: () => ({ subscriptions: { retrieve: h.retrieve } }),
}))

import { checkSubscriptionHealth } from '@/lib/subscription-health'

const trainer = (over: Record<string, unknown> = {}) => ({
  stripeSubscriptionId: 'sub_1',
  sandboxBilling: false,
  ...over,
}) as { stripeSubscriptionId: string | null; sandboxBilling: boolean }

beforeEach(() => {
  vi.clearAllMocks()
  h.isStripeConfigured.mockReturnValue(true)
})

describe('checkSubscriptionHealth', () => {
  it('says nothing for an account with no subscription — a trialist is not broken', async () => {
    await expect(checkSubscriptionHealth(trainer({ stripeSubscriptionId: null }))).resolves.toEqual({ state: 'none' })
    expect(h.retrieve).not.toHaveBeenCalled()
  })

  it('does not guess when Stripe is not configured in this environment', async () => {
    h.isStripeConfigured.mockReturnValue(false)
    await expect(checkSubscriptionHealth(trainer())).resolves.toEqual({ state: 'unchecked' })
    expect(h.retrieve).not.toHaveBeenCalled()
  })

  it('is quiet when the subscription is alive', async () => {
    h.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active' })
    await expect(checkSubscriptionHealth(trainer())).resolves.toMatchObject({ state: 'ok', status: 'active' })
  })

  it('counts past_due as alive — they are still a customer, just behind', async () => {
    h.retrieve.mockResolvedValue({ id: 'sub_1', status: 'past_due' })
    await expect(checkSubscriptionHealth(trainer())).resolves.toMatchObject({ state: 'ok' })
  })

  it('calls out the one that broke a real customer: it is not there', async () => {
    h.retrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    await expect(checkSubscriptionHealth(trainer())).resolves.toEqual({ state: 'missing', id: 'sub_1' })
  })

  it('separates cancelled from missing — both are not billing, but only one is our fault', async () => {
    h.retrieve.mockResolvedValue({ id: 'sub_1', status: 'canceled' })
    await expect(checkSubscriptionHealth(trainer())).resolves.toMatchObject({ state: 'inactive', status: 'canceled' })
  })

  it('an unreachable Stripe says "unknown", never "missing"', async () => {
    h.retrieve.mockRejectedValue(Object.assign(new Error('connection error'), { type: 'StripeConnectionError' }))
    const r = await checkSubscriptionHealth(trainer())
    expect(r.state).toBe('unknown')
  })

  it('checks a sandbox account against the sandbox key', async () => {
    h.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active' })
    await checkSubscriptionHealth(trainer({ sandboxBilling: true }))
    expect(h.isStripeConfigured).toHaveBeenCalledWith(true)
  })
})
