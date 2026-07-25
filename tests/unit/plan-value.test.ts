import { describe, it, expect, vi, beforeEach } from 'vitest'

// planValueFor / summarisePlanValues are pure — they price a customer's plan
// from the catalog (Core + seats + active add-ons) and roll the results up by
// currency. getEnabledAddonsBatch is the batched DB read the admin list uses;
// it must apply the same default-on + expiry rules as getEnabledAddons.
import { planValueFor, summarisePlanValues, normaliseCurrency } from '@/lib/plan-value'
import {
  CORE_PRICE,
  SEAT_PRICE,
  ADDONS,
  DEFAULT_CURRENCY,
  addonById,
} from '@/lib/pricing'

describe('planValueFor', () => {
  it('prices Core alone for a solo, add-on-free customer', () => {
    const v = planValueFor({ payoutCurrency: 'NZD', seatCount: 1, enabledAddonIds: [] })
    expect(v.currency).toBe('NZD')
    expect(v.monthly).toBe(CORE_PRICE.NZD)
    expect(v.annual).toBe(CORE_PRICE.NZD * 12)
  })

  it('adds extra seats (first seat is included) and paid add-ons', () => {
    const achievements = addonById('achievements')!.price.NZD
    const v = planValueFor({ payoutCurrency: 'NZD', seatCount: 3, enabledAddonIds: ['achievements'] })
    // Core + 2 extra seats + achievements
    expect(v.monthly).toBe(CORE_PRICE.NZD + 2 * SEAT_PRICE.NZD + achievements)
    expect(v.annual).toBe(v.monthly * 12)
  })

  it('prices in the customer\'s own currency', () => {
    const v = planValueFor({ payoutCurrency: 'GBP', seatCount: 1, enabledAddonIds: [] })
    expect(v.currency).toBe('GBP')
    expect(v.monthly).toBe(CORE_PRICE.GBP)
  })

  it('free/default-on add-ons contribute nothing', () => {
    const solo = planValueFor({ payoutCurrency: 'NZD', seatCount: 1, enabledAddonIds: [] })
    const withFree = planValueFor({ payoutCurrency: 'NZD', seatCount: 1, enabledAddonIds: ['classes', 'notes', 'clientapp'] })
    expect(withFree.monthly).toBe(solo.monthly)
  })

  it('falls back to the default currency for unknown/null values', () => {
    expect(normaliseCurrency('EUR')).toBe(DEFAULT_CURRENCY)
    expect(normaliseCurrency(null)).toBe(DEFAULT_CURRENCY)
    expect(planValueFor({ payoutCurrency: null, seatCount: null, enabledAddonIds: [] }).currency).toBe(DEFAULT_CURRENCY)
    // null seatCount is treated as 1 (Core only, no extra seats)
    expect(planValueFor({ payoutCurrency: 'NZD', seatCount: null, enabledAddonIds: [] }).monthly).toBe(CORE_PRICE.NZD)
  })
})

describe('summarisePlanValues', () => {
  it('groups MRR/ARR by currency and leads with the largest', () => {
    const nzdSolo = planValueFor({ payoutCurrency: 'NZD', seatCount: 1, enabledAddonIds: [] })
    const nzdBig = planValueFor({ payoutCurrency: 'NZD', seatCount: 4, enabledAddonIds: [] })
    const gbp = planValueFor({ payoutCurrency: 'GBP', seatCount: 1, enabledAddonIds: [] })

    const summary = summarisePlanValues([nzdSolo, gbp, nzdBig])
    expect(summary).toHaveLength(2)

    const nzd = summary.find(s => s.currency === 'NZD')!
    expect(nzd.count).toBe(2)
    expect(nzd.mrr).toBe(nzdSolo.monthly + nzdBig.monthly)
    expect(nzd.arr).toBe(nzd.mrr * 12)

    // NZD total exceeds the single GBP customer, so it leads.
    expect(summary[0].currency).toBe('NZD')
  })

  it('returns nothing for no paying customers', () => {
    expect(summarisePlanValues([])).toEqual([])
  })
})

// --- Batched add-on loader (DB) ---
const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerAddon: { findMany: h.findMany } },
}))

import { getEnabledAddonsBatch } from '@/lib/billing'

const DEFAULT_ON = ADDONS.filter(a => a.defaultOn).map(a => a.id)
const future = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
const past = () => new Date(Date.now() - 60 * 1000)

beforeEach(() => vi.clearAllMocks())

describe('getEnabledAddonsBatch', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const res = await getEnabledAddonsBatch([])
    expect(res.size).toBe(0)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('reads once and applies default-on, explicit-off and expiry rules per trainer', async () => {
    h.findMany.mockResolvedValue([
      // t1: bought a paid add-on (active), and turned OFF a default-on one.
      { trainerId: 't1', itemId: 'achievements', active: true, expiresAt: null },
      { trainerId: 't1', itemId: DEFAULT_ON[0], active: false, expiresAt: null },
      // t2: an expired grant (should NOT count as enabled).
      { trainerId: 't2', itemId: 'marketing', active: true, expiresAt: past() },
      // t2: a still-valid grant.
      { trainerId: 't2', itemId: 'shop', active: true, expiresAt: future() },
    ])

    const res = await getEnabledAddonsBatch(['t1', 't2', 't3'])
    expect(h.findMany).toHaveBeenCalledTimes(1)

    const t1 = res.get('t1')!
    expect(t1.has('achievements')).toBe(true)
    expect(t1.has(DEFAULT_ON[0])).toBe(false) // explicitly turned off
    expect(t1.has(DEFAULT_ON[1])).toBe(true)  // untouched default-on stays on

    const t2 = res.get('t2')!
    expect(t2.has('marketing')).toBe(false) // expired
    expect(t2.has('shop')).toBe(true)

    // t3 had no rows at all — still gets the full default-on set.
    const t3 = res.get('t3')!
    for (const id of DEFAULT_ON) expect(t3.has(id)).toBe(true)
    expect(t3.has('achievements')).toBe(false)
  })
})
