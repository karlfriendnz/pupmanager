import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ discFindMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { discount: { findMany: h.discFindMany } } }))

import { scaleLinesToNet, dogSubjects, quoteOfferingDiscount } from '@/lib/discounts/quote'

describe('scaleLinesToNet', () => {
  it('scales lines to sum exactly to gross − discount (integer cents)', () => {
    const out = scaleLinesToNet([1800, 1800, 1500], 1400)
    expect(out.reduce((s, a) => s + a, 0)).toBe(5100 - 1400)
    expect(out.every(Number.isInteger)).toBe(true)
  })

  it('distributes rounding remainder without losing a cent', () => {
    const out = scaleLinesToNet([1000, 1000, 1000], 100)
    expect(out.reduce((s, a) => s + a, 0)).toBe(2900)
  })

  it('returns lines unchanged when there is no discount', () => {
    expect(scaleLinesToNet([1000, 500], 0)).toEqual([1000, 500])
  })

  it('never goes negative when the discount exceeds the total', () => {
    const out = scaleLinesToNet([1000, 500], 9999)
    expect(out).toEqual([0, 0])
  })
})

describe('dogSubjects', () => {
  it('builds one context per dog, sharing the group size', () => {
    const subs = dogSubjects({ dogCount: 2, perDogAmounts: [1800, 1500], dates: ['2026-08-05T09:00:00Z', '2026-08-05T13:00:00Z'] })
    expect(subs).toHaveLength(2)
    expect(subs[0].personCount).toBe(2)
    expect(subs[0].personTotal).toBe(3300)
    expect(subs[0].selectedItemCount).toBe(2)
    expect(subs[0].dayCount).toBe(1)
  })
})

describe('quoteOfferingDiscount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies a second-dog discount across two dogs', async () => {
    h.discFindMany.mockResolvedValue([
      { id: 'd1', name: 'Second dog', formText: null, isActive: true, validFrom: null, expiresAt: null, modifierType: 'PERCENT', modifierValue: 25, applyTo: 'per_person', conditions: [{ key: 'group_size_min', operator: '>=', value: 2 }], order: 0 },
    ])
    const q = await quoteOfferingDiscount({ trainerId: 't1', packageId: 'p1', dogCount: 2, perDogAmounts: [3450], dates: ['2026-08-05T09:00:00Z'] })
    expect(q.discountTotal).toBe(Math.round(3450 * 0.25 * 2)) // total rounded once

  })

  it('is zero when no discounts are configured', async () => {
    h.discFindMany.mockResolvedValue([])
    const q = await quoteOfferingDiscount({ trainerId: 't1', packageId: 'p1', dogCount: 1, perDogAmounts: [3450], dates: [] })
    expect(q.discountTotal).toBe(0)
  })
})
