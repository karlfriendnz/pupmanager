import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the two infra deps so this stays a pure-logic test — no DB, no
// env. vi.mock is hoisted, so the shared handles come via vi.hoisted.
const { count, env } = vi.hoisted(() => ({
  count: vi.fn(),
  env: { STRIPE_FOUNDER_COUPON_ID: undefined as string | undefined },
}))
vi.mock('../../src/lib/prisma', () => ({ prisma: { trainerProfile: { count } } }))
vi.mock('../../src/lib/env', () => ({ env }))

import {
  FOUNDER_SEATS,
  isFounderCouponConfigured,
  founderSeatsRemaining,
  isFounderEligible,
} from '../../src/lib/founder'

beforeEach(() => {
  count.mockReset()
  env.STRIPE_FOUNDER_COUPON_ID = 'coupon_founder'
})

describe('founder coupon configuration', () => {
  it('off when no coupon env', () => {
    env.STRIPE_FOUNDER_COUPON_ID = undefined
    expect(isFounderCouponConfigured()).toBe(false)
  })
  it('on when coupon env set', () => {
    expect(isFounderCouponConfigured()).toBe(true)
  })
})

describe('founderSeatsRemaining', () => {
  it('full pool when none claimed', async () => {
    count.mockResolvedValue(0)
    expect(await founderSeatsRemaining()).toBe(FOUNDER_SEATS)
  })
  it('clamps to zero, never negative, if somehow over-claimed', async () => {
    count.mockResolvedValue(FOUNDER_SEATS + 3)
    expect(await founderSeatsRemaining()).toBe(0)
  })
  it('one left at the boundary', async () => {
    count.mockResolvedValue(FOUNDER_SEATS - 1)
    expect(await founderSeatsRemaining()).toBe(1)
  })
})

describe('isFounderEligible', () => {
  it('not eligible when coupon unconfigured even with seats free', async () => {
    env.STRIPE_FOUNDER_COUPON_ID = undefined
    count.mockResolvedValue(0)
    expect(await isFounderEligible(false)).toBe(false)
  })
  it('not eligible when trainer already claimed a seat', async () => {
    count.mockResolvedValue(0)
    expect(await isFounderEligible(true)).toBe(false)
  })
  it('not eligible when the pool is exhausted', async () => {
    count.mockResolvedValue(FOUNDER_SEATS)
    expect(await isFounderEligible(false)).toBe(false)
  })
  it('eligible: configured, new trainer, seats remain', async () => {
    count.mockResolvedValue(FOUNDER_SEATS - 1)
    expect(await isFounderEligible(false)).toBe(true)
  })
})
