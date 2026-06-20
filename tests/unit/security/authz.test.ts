import { describe, it, expect, vi } from 'vitest'

// connect.ts imports the Stripe client + env; stub both so we test only the pure
// fee math without loading the SDK or requiring real env.
vi.mock('../../../src/lib/stripe', () => ({ stripeFor: () => ({}), isStripeConfigured: () => true }))
vi.mock('../../../src/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com', PLATFORM_FEE_BPS: 500 } }))

import { can } from '../../../src/lib/permissions'
import { platformFeeAmount, platformFeeBps } from '../../../src/lib/connect'

// Mirrors the guard in trainer/team/[membershipId] PATCH: a non-OWNER may only
// grant permissions they themselves hold.
function canGrant(actorRole: 'OWNER' | 'MANAGER' | 'STAFF', actorPerms: Record<string, boolean> | null, key: Parameters<typeof can>[0]): boolean {
  return can(key, actorRole, actorPerms)
}

describe('team permission-grant escalation guard', () => {
  it('an OWNER can grant any permission', () => {
    expect(canGrant('OWNER', null, 'billing.seats')).toBe(true)
    expect(canGrant('OWNER', null, 'team.manage')).toBe(true)
  })

  it('a MANAGER who lacks billing.seats cannot grant it', () => {
    // MANAGER default does not include billing.seats, and no override grants it.
    expect(canGrant('MANAGER', null, 'billing.seats')).toBe(false)
  })

  it('a STAFF member cannot grant team.manage they do not hold', () => {
    expect(canGrant('STAFF', null, 'team.manage')).toBe(false)
  })

  it('a member CAN grant a permission they were explicitly granted', () => {
    expect(canGrant('STAFF', { 'clients.edit': true }, 'clients.edit')).toBe(true)
  })
})

describe('platform fee is server-derived and bounded', () => {
  it('computes the configured basis points', () => {
    expect(platformFeeBps()).toBe(500)
    expect(platformFeeAmount(10000)).toBe(500) // 5% of $100.00
  })

  it('never exceeds the charged amount and is never negative', () => {
    for (const amt of [0, 1, 99, 100, 12345, 9_999_99]) {
      const fee = platformFeeAmount(amt)
      expect(fee).toBeGreaterThanOrEqual(0)
      expect(fee).toBeLessThanOrEqual(amt)
    }
  })
})
