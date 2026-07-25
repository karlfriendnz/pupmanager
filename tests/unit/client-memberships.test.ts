import { describe, it, expect, vi, beforeEach } from 'vitest'

// The shared client-facing membership loader, used by BOTH the /my-memberships
// storefront and the Offerings flow. Pins the tenant/publish filter and the
// per-item label/image/description resolution (override wins over the
// offering's own; a class run's blurb comes from its package).

const h = vi.hoisted(() => ({
  membership: { findMany: vi.fn() },
  package: { findMany: vi.fn() },
  classRun: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h }))

import { loadPublishedMemberships } from '@/lib/client-memberships'

const CARD = {
  imageUrl: 'm.jpg', bgColor: '#fff', headerColor: '#000', textColor: '#333', featuredColor: '#7c3aed', buttonText: 'Join',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.package.findMany.mockResolvedValue([])
  h.classRun.findMany.mockResolvedValue([])
  h.product.findMany.mockResolvedValue([])
})

describe('loadPublishedMemberships', () => {
  it('asks only for this trainer\'s published one-off memberships', async () => {
    h.membership.findMany.mockResolvedValue([])
    const out = await loadPublishedMemberships('t1')

    expect(out).toEqual([])
    expect(h.membership.findMany.mock.calls[0][0].where).toEqual({ trainerId: 't1', published: true, cadence: 'ONE_OFF' })
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
