import { describe, it, expect, vi, beforeEach } from 'vitest'

// Narrowing the client shop to one of the trainer's tags.
//
// Two things are pinned here, and they are the two that would quietly break:
//  1. the filter is a WHERE on the product query, not a hide in the browser —
//     a client on a phone should not download a hundred products to look at
//     four; and
//  2. a tag that leads nowhere never reaches the screen, because a filter that
//     opens onto an empty shop reads as the shop being broken.

const h = vi.hoisted(() => ({
  product: { findMany: vi.fn() },
  tag: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h }))

import { listShopProducts } from '@/lib/shop-catalog'
import { listShopTags, resolveShopTag, toShopTags, type ShopTag } from '@/lib/shop-tags'

beforeEach(() => {
  vi.clearAllMocks()
  h.product.findMany.mockResolvedValue([])
  h.tag.findMany.mockResolvedValue([])
})

const tagRow = (
  id: string,
  name: string,
  items: { packageId: string | null; product: { active: boolean } | null }[],
) => ({ id, name, items })

describe('listShopProducts — the tag is a database filter', () => {
  it('asks the database for the tag, rather than everything', async () => {
    await listShopProducts('tr1', { tagId: 'tag-puppy' })
    const where = h.product.findMany.mock.calls[0][0].where
    expect(where).toEqual({ trainerId: 'tr1', active: true, tags: { some: { tagId: 'tag-puppy' } } })
  })

  it('still refuses inactive products inside a tag', async () => {
    await listShopProducts('tr1', { tagId: 'tag-puppy' })
    expect(h.product.findMany.mock.calls[0][0].where.active).toBe(true)
  })

  it('stays scoped to the trainer, so another business’s tag matches nothing', async () => {
    await listShopProducts('tr1', { tagId: 'tag-from-someone-else' })
    expect(h.product.findMany.mock.calls[0][0].where.trainerId).toBe('tr1')
  })

  it('is the unfiltered shop with no tag, and with a null one', async () => {
    await listShopProducts('tr1')
    await listShopProducts('tr1', { tagId: null })
    for (const call of h.product.findMany.mock.calls) {
      expect(call[0].where).toEqual({ trainerId: 'tr1', active: true })
      expect(call[0].where).not.toHaveProperty('tags')
    }
  })

  it('keeps the shop’s select and order when a tag is on', async () => {
    await listShopProducts('tr1')
    await listShopProducts('tr1', { tagId: 'tag-puppy' })
    const [plain, tagged] = h.product.findMany.mock.calls.map(c => c[0])
    expect(tagged.select).toEqual(plain.select)
    expect(tagged.orderBy).toEqual(plain.orderBy)
  })
})

describe('toShopTags — which tags are worth offering', () => {
  it('counts only the products a client may actually see', () => {
    const out = toShopTags([
      tagRow('t1', 'Puppy', [
        { packageId: null, product: { active: true } },
        { packageId: null, product: { active: false } },
        { packageId: null, product: { active: true } },
      ]),
    ])
    expect(out).toEqual([{ id: 't1', name: 'Puppy', products: 2, alsoBookable: false }])
  })

  it('drops a tag with nothing in the shop, so no filter opens onto nothing', () => {
    const out = toShopTags([
      tagRow('t1', 'Never used', []),
      tagRow('t2', 'Classes only', [{ packageId: 'p1', product: null }]),
      tagRow('t3', 'All withdrawn', [{ packageId: null, product: { active: false } }]),
      tagRow('t4', 'Puppy', [{ packageId: null, product: { active: true } }]),
    ])
    expect(out.map(t => t.id)).toEqual(['t4'])
  })

  it('marks the tag that reaches past the shop', () => {
    const out = toShopTags([
      tagRow('t1', 'Puppy', [
        { packageId: 'pkg1', product: null },
        { packageId: null, product: { active: true } },
      ]),
      tagRow('t2', 'Treats', [{ packageId: null, product: { active: true } }]),
    ])
    expect(out.map(t => t.alsoBookable)).toEqual([true, false])
  })

  it('leaves the trainer’s arrangement alone', () => {
    const out = toShopTags([
      tagRow('t3', 'Zebra', [{ packageId: null, product: { active: true } }]),
      tagRow('t1', 'Apple', [{ packageId: null, product: { active: true } }]),
    ])
    expect(out.map(t => t.name)).toEqual(['Zebra', 'Apple'])
  })
})

describe('listShopTags', () => {
  it('reads one trainer’s tags in their own order', async () => {
    h.tag.findMany.mockResolvedValue([
      tagRow('t1', 'Puppy', [{ packageId: null, product: { active: true } }]),
    ])
    const out = await listShopTags('tr1')
    const args = h.tag.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ trainerId: 'tr1' })
    expect(args.orderBy).toEqual([{ order: 'asc' }, { name: 'asc' }])
    expect(out).toEqual([{ id: 't1', name: 'Puppy', products: 1, alsoBookable: false }])
  })
})

describe('resolveShopTag — what the URL is allowed to mean', () => {
  const tags: ShopTag[] = [
    { id: 't1', name: 'Puppy', products: 2, alsoBookable: true },
    { id: 't2', name: 'Treats', products: 1, alsoBookable: false },
  ]

  it('resolves a tag this shop offers', () => {
    expect(resolveShopTag(tags, 't2')?.name).toBe('Treats')
  })

  it('ignores an unknown, emptied or foreign tag rather than filtering to nothing', () => {
    expect(resolveShopTag(tags, 'tag-from-another-business')).toBeNull()
    expect(resolveShopTag([], 't1')).toBeNull()
  })

  it('is the whole shop with no param', () => {
    expect(resolveShopTag(tags, null)).toBeNull()
    expect(resolveShopTag(tags, undefined)).toBeNull()
    expect(resolveShopTag(tags, '')).toBeNull()
  })
})
