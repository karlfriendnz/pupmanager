import { describe, it, expect } from 'vitest'
import { trainerLifecycle, isPayingCustomer, lifecycleProfileFilter } from '@/lib/trainer-lifecycle'

// The case this whole module exists for: starting a plan carries the trainer's
// REMAINING free-trial days into Stripe (checkout sets trial_period_days), so
// Stripe reports `trialing` and the webhook stores TRIALING — even though the
// trainer has entered a card and committed. They must read as a paying customer.
describe('trainerLifecycle', () => {
  it('a subscriber still inside the carried-over trial window is PAYING', () => {
    const p = { subscriptionStatus: 'TRIALING' as const, stripeSubscriptionId: 'sub_123' }
    expect(trainerLifecycle(p)).toBe('paying')
    expect(isPayingCustomer(p)).toBe(true)
  })

  it('a genuine free trial (no subscription) is TRIAL', () => {
    const p = { subscriptionStatus: 'TRIALING' as const, stripeSubscriptionId: null }
    expect(trainerLifecycle(p)).toBe('trial')
    expect(isPayingCustomer(p)).toBe(false)
  })

  it('ACTIVE and PAST_DUE subscribers are paying', () => {
    expect(trainerLifecycle({ subscriptionStatus: 'ACTIVE', stripeSubscriptionId: 'sub_1' })).toBe('paying')
    expect(trainerLifecycle({ subscriptionStatus: 'PAST_DUE', stripeSubscriptionId: 'sub_1' })).toBe('paying')
  })

  it('CANCELLED is churned even with a subscription id left behind', () => {
    expect(trainerLifecycle({ subscriptionStatus: 'CANCELLED', stripeSubscriptionId: 'sub_1' })).toBe('churned')
    expect(isPayingCustomer({ subscriptionStatus: 'CANCELLED', stripeSubscriptionId: 'sub_1' })).toBe(false)
  })

  it('no status / no subscription is none', () => {
    expect(trainerLifecycle({ subscriptionStatus: null, stripeSubscriptionId: null })).toBe('none')
    expect(trainerLifecycle({ subscriptionStatus: 'INACTIVE', stripeSubscriptionId: null })).toBe('none')
  })

  // A stale status with no subscription must not be counted as revenue.
  it('ACTIVE without a subscription id is not paying', () => {
    expect(isPayingCustomer({ subscriptionStatus: 'ACTIVE', stripeSubscriptionId: null })).toBe(false)
  })
})

describe('lifecycleProfileFilter', () => {
  it('paying requires a subscription id, trial requires its absence', () => {
    expect(lifecycleProfileFilter('paying')).toEqual({
      stripeSubscriptionId: { not: null },
      subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] },
    })
    expect(lifecycleProfileFilter('trial')).toEqual({
      subscriptionStatus: 'TRIALING',
      stripeSubscriptionId: null,
    })
  })

  // The tab buckets must not double-count anyone.
  it('trial and paying are mutually exclusive', () => {
    const trial = lifecycleProfileFilter('trial')
    const paying = lifecycleProfileFilter('paying')
    expect(trial.stripeSubscriptionId).toBeNull()
    expect(paying.stripeSubscriptionId).toEqual({ not: null })
  })
})
