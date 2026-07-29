import { describe, it, expect, vi, beforeEach } from 'vitest'

// Instant sale (pos) has no switch — it comes with the shop. FOUR separate gates
// ask about it (the nav's Sell action, the session screen, the receivables API and
// the guest-sale API), which is exactly why the rule lives in the resolution layer
// instead of in each caller.

const h = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { trainerAddon: { findMany: h.findMany, findUnique: h.findUnique } },
}))

import { getEnabledAddons, getEnabledAddonsBatch, hasAddon } from '@/lib/billing'

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.findUnique.mockResolvedValue(null)
})

describe('getEnabledAddons', () => {
  it('gives Instant sale to a trainer who has the shop', async () => {
    h.findMany.mockResolvedValue([{ itemId: 'shop', active: true, expiresAt: null }])
    const on = await getEnabledAddons('t1')
    expect(on.has('shop')).toBe(true)
    expect(on.has('pos')).toBe(true)
  })

  it('withholds it from a trainer who has no shop', async () => {
    const on = await getEnabledAddons('t1')
    expect(on.has('pos')).toBe(false)
  })

  // Nobody loses a feature to a tidy-up: a trainer who turned Instant sale on
  // while it still had a switch keeps it, shop or no shop.
  it('keeps an explicitly enabled Instant sale without the shop', async () => {
    h.findMany.mockResolvedValue([{ itemId: 'pos', active: true, expiresAt: null }])
    const on = await getEnabledAddons('t1')
    expect(on.has('pos')).toBe(true)
    expect(on.has('shop')).toBe(false)
  })

  // A lapsed comp grant on the shop takes the rider with it.
  it('drops it when the shop grant has expired', async () => {
    h.findMany.mockResolvedValue([
      { itemId: 'shop', active: true, expiresAt: new Date(Date.now() - 86_400_000) },
    ])
    const on = await getEnabledAddons('t1')
    expect(on.has('shop')).toBe(false)
    expect(on.has('pos')).toBe(false)
  })
})

describe('hasAddon', () => {
  it('is true for Instant sale when the shop is on', async () => {
    h.findUnique.mockImplementation(async ({ where }: { where: { trainerId_itemId: { itemId: string } } }) =>
      where.trainerId_itemId.itemId === 'shop' ? { active: true, expiresAt: null } : null)
    expect(await hasAddon('t1', 'pos')).toBe(true)
  })

  it('is false for Instant sale with no shop', async () => {
    expect(await hasAddon('t1', 'pos')).toBe(false)
  })

  // An explicit row always wins over the ride-along, in both directions.
  it('honours an explicit OFF on Instant sale even with the shop on', async () => {
    h.findUnique.mockImplementation(async ({ where }: { where: { trainerId_itemId: { itemId: string } } }) =>
      where.trainerId_itemId.itemId === 'pos'
        ? { active: false, expiresAt: null }
        : { active: true, expiresAt: null })
    expect(await hasAddon('t1', 'pos')).toBe(false)
  })
})

describe('getEnabledAddonsBatch', () => {
  it('applies the same rule per trainer', async () => {
    h.findMany.mockResolvedValue([
      { trainerId: 'a', itemId: 'shop', active: true, expiresAt: null },
    ])
    const map = await getEnabledAddonsBatch(['a', 'b'])
    expect(map.get('a')!.has('pos')).toBe(true)
    expect(map.get('b')!.has('pos')).toBe(false)
  })
})
