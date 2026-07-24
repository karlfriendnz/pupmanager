import { describe, it, expect, vi, beforeEach } from 'vitest'

// Admin comp grants (grantedByAdmin) can carry an expiresAt. Gating must treat
// an expired grant as OFF while still-active ones stay ON — the whole point of a
// timed free trial. These prove hasAddon/getEnabledAddons honour the expiry.
const h = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerAddon: { findMany: h.findMany, findUnique: h.findUnique } },
}))

import { hasAddon, getEnabledAddons } from '@/lib/billing'

const future = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
const past = () => new Date(Date.now() - 60 * 1000)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasAddon honours grant expiry', () => {
  it('true while the grant is unexpired', async () => {
    h.findUnique.mockResolvedValue({ active: true, expiresAt: future() })
    expect(await hasAddon('t1', 'shop')).toBe(true)
  })

  it('false once the grant has expired (row still active in DB)', async () => {
    h.findUnique.mockResolvedValue({ active: true, expiresAt: past() })
    expect(await hasAddon('t1', 'shop')).toBe(false)
  })

  it('true for an open-ended grant (no expiry)', async () => {
    h.findUnique.mockResolvedValue({ active: true, expiresAt: null })
    expect(await hasAddon('t1', 'shop')).toBe(true)
  })

  it('false when the row is inactive regardless of expiry', async () => {
    h.findUnique.mockResolvedValue({ active: false, expiresAt: future() })
    expect(await hasAddon('t1', 'shop')).toBe(false)
  })
})

describe('getEnabledAddons honours grant expiry', () => {
  it('includes an unexpired grant, excludes an expired one', async () => {
    h.findMany.mockResolvedValue([
      { itemId: 'shop', active: true, expiresAt: future() },
      { itemId: 'marketing', active: true, expiresAt: past() },
    ])
    const enabled = await getEnabledAddons('t1')
    expect(enabled.has('shop')).toBe(true)
    expect(enabled.has('marketing')).toBe(false)
  })

  it('an unexpired null-expiry grant is enabled', async () => {
    h.findMany.mockResolvedValue([{ itemId: 'shop', active: true, expiresAt: null }])
    expect((await getEnabledAddons('t1')).has('shop')).toBe(true)
  })
})
