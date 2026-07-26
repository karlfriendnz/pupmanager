import { describe, it, expect, vi, beforeEach } from 'vitest'

// The shared client-facing membership loader, used by BOTH the /my-memberships
// storefront and the Offerings flow. Pins the tenant/publish filter and the
// per-item label/image/description resolution (override wins over the
// offering's own; a class run's blurb comes from its package).

const h = vi.hoisted(() => ({
  membership: { findMany: vi.fn() },
  membershipRequest: { findMany: vi.fn() },
  package: { findMany: vi.fn() },
  classRun: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
}))
// The loader is add-on gated; these tests are about what it loads, so it's on.
vi.mock('@/lib/billing', () => ({ hasAddon: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({ prisma: h }))

import { loadPublishedMemberships } from '@/lib/client-memberships'

const CARD = {
  imageUrl: 'm.jpg', bgColor: '#fff', headerColor: '#000', textColor: '#333', featuredColor: '#7c3aed',
  buttonBgColor: '#0d9488', buttonTextColor: '#ffffff', buttonText: 'Join',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.package.findMany.mockResolvedValue([])
  h.classRun.findMany.mockResolvedValue([])
  h.product.findMany.mockResolvedValue([])
  h.membershipRequest.findMany.mockResolvedValue([])
})

describe('loadPublishedMemberships', () => {
  it('asks only for this trainer\'s published memberships', async () => {
    h.membership.findMany.mockResolvedValue([])
    const out = await loadPublishedMemberships('t1')

    expect(out).toEqual([])
    // No cadence filter: a recurring plan is loaded too (flagged unbuyable
    // below) rather than vanishing from both client screens with no explanation.
    expect(h.membership.findMany.mock.calls[0][0].where).toEqual({ trainerId: 't1', published: true })
    // Nothing to resolve — no follow-up offering queries.
    expect(h.package.findMany).not.toHaveBeenCalled()
    expect(h.classRun.findMany).not.toHaveBeenCalled()
    expect(h.product.findMany).not.toHaveBeenCalled()
  })

  it('resolves each item from its offering, with per-item overrides winning', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Puppy Starter', description: '<p>Everything</p>', priceCents: 12000, ...CARD,
      items: [
        // No overrides — falls back to the package's own name/description.
        { packageId: 'p1', classRunId: null, productId: null, quantity: 2, imageUrl: null, description: null },
        // Class run: image is its own, blurb comes from its package.
        { packageId: null, classRunId: 'r1', productId: null, quantity: 1, imageUrl: null, description: null },
        // Overrides win over the product's own image + description.
        { packageId: null, classRunId: null, productId: 'x1', quantity: 1, imageUrl: 'over.jpg', description: 'Override blurb' },
      ],
    }])
    h.package.findMany.mockResolvedValue([{ id: 'p1', name: '4-pack', description: 'Four sessions' }])
    h.classRun.findMany.mockResolvedValue([{ id: 'r1', name: 'Puppy 101', imageUrl: 'run.jpg', package: { description: 'From the package' } }])
    h.product.findMany.mockResolvedValue([{ id: 'x1', name: 'Lead', imageUrl: 'lead.jpg', description: 'Own blurb' }])

    const [m] = await loadPublishedMemberships('t1')

    expect(m).toMatchObject({ id: 'm1', name: 'Puppy Starter', priceCents: 12000, ...CARD })
    expect(m.items).toEqual([
      { label: '4-pack', quantity: 2, imageUrl: null, description: 'Four sessions' },
      { label: 'Puppy 101', quantity: 1, imageUrl: 'run.jpg', description: 'From the package' },
      { label: 'Lead', quantity: 1, imageUrl: 'over.jpg', description: 'Override blurb' },
    ])
  })

  // A one-off with a price is the only thing POST /api/my/memberships/[id]/buy
  // will take — it 409s a recurring plan ("not available to buy yet") and a
  // zero price. `buyable` mirrors that exactly so the card can never offer a
  // button the API refuses.
  it('marks a one-off with a price buyable', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Bundle', description: null, priceCents: 12000, cadence: 'ONE_OFF', interval: null,
      ...CARD, items: [], plans: [],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.buyable).toBe(true)
    expect(m.cadence).toBe('ONE_OFF')
    // No "/ month" suffix should ever be derivable for a one-off.
    expect(m.interval).toBeNull()
    expect(m.plans).toEqual([])
  })

  it('returns a recurring plan, flagged unbuyable, with its interval and options', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm2', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH',
      ...CARD, items: [],
      plans: [{ id: 'pl1', interval: 'WEEK', priceCents: 10000 }, { id: 'pl2', interval: 'MONTH', priceCents: 40000 }],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m).toMatchObject({ id: 'm2', cadence: 'RECURRING', interval: 'MONTH', buyable: false })
    expect(m.plans).toEqual([
      { id: 'pl1', interval: 'WEEK', priceCents: 10000 },
      { id: 'pl2', interval: 'MONTH', priceCents: 40000 },
    ])
  })

  it('marks an unpriced one-off unbuyable', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm3', name: 'Free?', description: null, priceCents: 0, cadence: 'ONE_OFF', interval: null,
      ...CARD, items: [], plans: [],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.buyable).toBe(false)
  })

  // The card's "Requested" state is read from the DB, not held in component
  // state — otherwise a reload forgets it and the client taps again (and again).
  it('marks a package the client has already asked for as requested', async () => {
    h.membership.findMany.mockResolvedValue([
      { id: 'm1', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', ...CARD, items: [], plans: [] },
      { id: 'm2', name: 'Other', description: null, priceCents: 0, cadence: 'ONE_OFF', interval: null, ...CARD, items: [], plans: [] },
    ])
    h.membershipRequest.findMany.mockResolvedValue([{ membershipId: 'm1' }])

    const out = await loadPublishedMemberships('t1', 'c1')

    expect(out.map(m => [m.id, m.requested, m.blockedReason])).toEqual([
      ['m1', true, 'RECURRING'],
      ['m2', false, 'NO_PRICE'],
    ])
    expect(h.membershipRequest.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', status: 'PENDING' })
  })

  it('skips the request lookup entirely when no client is in context', async () => {
    h.membership.findMany.mockResolvedValue([
      { id: 'm1', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', ...CARD, items: [], plans: [] },
    ])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.requested).toBe(false)
    expect(h.membershipRequest.findMany).not.toHaveBeenCalled()
  })

  it('drops items whose offering no longer exists rather than rendering a blank row', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Bundle', description: null, priceCents: 5000, ...CARD,
      items: [
        { packageId: 'gone', classRunId: null, productId: null, quantity: 1, imageUrl: null, description: null },
        { packageId: 'p1', classRunId: null, productId: null, quantity: 1, imageUrl: null, description: null },
      ],
    }])
    h.package.findMany.mockResolvedValue([{ id: 'p1', name: 'Still here', description: null }])

    const [m] = await loadPublishedMemberships('t1')

    expect(m.items).toEqual([{ label: 'Still here', quantity: 1, imageUrl: null, description: null }])
  })
})
