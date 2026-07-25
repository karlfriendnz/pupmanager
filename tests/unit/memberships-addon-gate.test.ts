import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ADDONS, type AddonId } from '@/lib/pricing'

// Memberships became a trainer add-on (free, off until switched on) alongside
// Events and Doggy Daycare. Gating has to hold at all three layers — nav, page
// and API — plus the client-facing side, or a switched-off trainer still sells
// memberships to their clients.

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8')

describe('memberships add-on catalog entry', () => {
  it('is in the catalog, free, and off until switched on', () => {
    const entry = ADDONS.find(a => a.id === ('memberships' as AddonId))
    expect(entry).toBeDefined()
    expect(entry?.free).toBe(true)
    // No defaultOn: an offering type a trainer opts into, like events/daycare.
    expect(entry?.defaultOn).toBeFalsy()
    expect(entry?.hidden).toBeFalsy() // must be visible on the Add-ons tab
  })

  it('sits with the other offering-type add-ons, which are all switch-on', () => {
    for (const id of ['events', 'puppyschool', 'memberships']) {
      const entry = ADDONS.find(a => a.id === id)
      expect(entry, `${id} missing from catalog`).toBeDefined()
      expect(entry?.defaultOn, `${id} should be off by default`).toBeFalsy()
    }
  })
})

describe('memberships add-on gating', () => {
  it('the nav shows a locked row when it is off', () => {
    expect(read('src/app/(trainer)/layout.tsx')).toContain("'/memberships': 'memberships'")
  })

  it('the page bounces to the Add-ons tab', () => {
    const page = read('src/app/(trainer)/memberships/page.tsx')
    expect(page).toContain("hasAddon(trainerId, 'memberships')")
    expect(page).toContain("redirect('/settings?tab=addons')")
  })

  it('creating a membership through the API is refused while it is off', () => {
    const route = read('src/app/api/trainer/memberships/route.ts')
    expect(route).toContain("hasAddon(ctx.companyId, 'memberships')")
    expect(route).toMatch(/status:\s*403/)
  })

  it('the client buy route refuses too, so an old link cannot be used', () => {
    const route = read('src/app/api/my/memberships/[membershipId]/buy/route.ts')
    expect(route).toContain("hasAddon(profile.trainerId, 'memberships')")
  })
})

// The client storefront loader is the one clients actually read through.
const h = vi.hoisted(() => ({ membershipFindMany: vi.fn(), hasAddon: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { membership: { findMany: h.membershipFindMany } } }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))

const { loadPublishedMemberships } = await import('@/lib/client-memberships')

beforeEach(() => vi.clearAllMocks())

describe('loadPublishedMemberships respects the add-on', () => {
  it('returns nothing — and does not even query — when the trainer has it off', async () => {
    h.hasAddon.mockResolvedValue(false)

    expect(await loadPublishedMemberships('t1')).toEqual([])
    expect(h.membershipFindMany).not.toHaveBeenCalled()
  })

  it('loads as normal when it is on', async () => {
    h.hasAddon.mockResolvedValue(true)
    h.membershipFindMany.mockResolvedValue([])

    expect(await loadPublishedMemberships('t1')).toEqual([])
    expect(h.membershipFindMany).toHaveBeenCalled()
  })
})
