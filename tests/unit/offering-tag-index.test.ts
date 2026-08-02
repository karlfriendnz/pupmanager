import { describe, it, expect, vi, beforeEach } from 'vitest'

// The tags an offering LIST page reads before it can group itself.
//
// Two things have to hold or the tag icon on /packages, /classes, /events and
// /casual-classes is worse than not having it. First, it is ONE query for the
// whole page — the four lists render up to a few hundred rows and a read per
// row would make grouping the slowest thing on the screen. Second, it comes
// back in the trainer's own tag arrangement, because the headings on the list
// have to sit in the same order as the tags on their tag screen; a different
// order in each place is how a trainer stops trusting either.
const h = vi.hoisted(() => ({ tagFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { tag: { findMany: h.tagFindMany } } }))

import { indexOfferingTags, listOfferingTags, type TagWithPackages } from '@/lib/tags'

const PUPPY = { id: 't_puppy', name: 'Puppy' }
const RECALL = { id: 't_recall', name: 'Recall' }
const REACTIVE = { id: 't_reactive', name: 'Reactive' }

const tag = (t: { id: string; name: string }, ...packageIds: (string | null)[]): TagWithPackages => ({
  ...t,
  items: packageIds.map(packageId => ({ packageId })),
})

describe('indexOfferingTags — what each offering carries', () => {
  it('hands back a row\'s tags keyed by the package they are on', () => {
    const index = indexOfferingTags([tag(PUPPY, 'pkg_a'), tag(RECALL, 'pkg_b')])
    expect(index.byPackage).toEqual({
      pkg_a: [PUPPY],
      pkg_b: [RECALL],
    })
  })

  it('gives one offering ALL of its tags — it belongs under each heading', () => {
    // The rule the whole feature turns on: a tag is a label, not a folder, so
    // a course that is both a puppy class and a recall class must arrive
    // carrying both or groupOfferingsByTag can only file it once.
    const index = indexOfferingTags([tag(PUPPY, 'pkg_a'), tag(RECALL, 'pkg_a')])
    expect(index.byPackage.pkg_a).toEqual([PUPPY, RECALL])
  })

  it('keeps a row\'s tags in the trainer\'s arrangement, not alphabetically', () => {
    // The caller reads them ordered; the index must not re-sort behind it, or
    // the words under one card read in a different order to the headings above.
    const index = indexOfferingTags([tag(REACTIVE, 'pkg_a'), tag(PUPPY, 'pkg_a')])
    expect(index.byPackage.pkg_a).toEqual([REACTIVE, PUPPY])
  })

  it('counts one tag on several offerings once per offering', () => {
    const index = indexOfferingTags([tag(PUPPY, 'pkg_a', 'pkg_b', 'pkg_c')])
    expect(Object.keys(index.byPackage).sort()).toEqual(['pkg_a', 'pkg_b', 'pkg_c'])
    expect(index.byPackage.pkg_b).toEqual([PUPPY])
  })

  it('leaves an untagged offering out of the map entirely', () => {
    // The page reads `byPackage[id] ?? []`, so absent and empty mean the same
    // thing — and absent is the one that stays small on a big list.
    const index = indexOfferingTags([tag(PUPPY, 'pkg_a')])
    expect(index.byPackage.pkg_zzz).toBeUndefined()
  })

  it('ignores an assignment with no package — that is a product', () => {
    // A tag reaches the shop too. A product row arriving here would put a bag
    // of treats under a heading on the classes page.
    const index = indexOfferingTags([tag(PUPPY, null, 'pkg_a')])
    expect(index.byPackage).toEqual({ pkg_a: [PUPPY] })
  })
})

describe('indexOfferingTags — the trainer\'s arrangement', () => {
  it('returns every tag id in the order it arrived', () => {
    const index = indexOfferingTags([tag(PUPPY, 'pkg_a'), tag(RECALL, 'pkg_b'), tag(REACTIVE, 'pkg_c')])
    expect(index.order).toEqual([PUPPY.id, RECALL.id, REACTIVE.id])
  })

  it('keeps a tag holding nothing in the order', () => {
    // `order` is the trainer's ARRANGEMENT, not a list of what is on this page.
    // An empty tag is the one they are about to fill, and dropping it here
    // would shuffle the headings the moment they did.
    const index = indexOfferingTags([tag(PUPPY), tag(RECALL, 'pkg_b')])
    expect(index.order).toEqual([PUPPY.id, RECALL.id])
    expect(index.byPackage).toEqual({ pkg_b: [RECALL] })
  })

  it('is empty, not broken, for a trainer who has never made a tag', () => {
    expect(indexOfferingTags([])).toEqual({ order: [], byPackage: {} })
  })
})

describe('listOfferingTags — how the page reads it', () => {
  beforeEach(() => {
    h.tagFindMany.mockReset()
    h.tagFindMany.mockResolvedValue([tag(PUPPY, 'pkg_a')])
  })

  it('reads the whole page in ONE query', async () => {
    await listOfferingTags('trainer_1')
    expect(h.tagFindMany).toHaveBeenCalledTimes(1)
  })

  it('scopes to the signed-in business', async () => {
    // Scoping at the tag end is enough: a tag belongs to exactly one trainer,
    // so an assignment reached through it can only point at their own package.
    await listOfferingTags('trainer_1')
    expect(h.tagFindMany.mock.calls[0][0].where).toEqual({ trainerId: 'trainer_1' })
  })

  it('asks for the trainer\'s own arrangement, the same as listTags()', async () => {
    await listOfferingTags('trainer_1')
    expect(h.tagFindMany.mock.calls[0][0].orderBy).toEqual([{ order: 'asc' }, { name: 'asc' }])
  })

  it('asks only for package assignments, never product ones', async () => {
    await listOfferingTags('trainer_1')
    expect(h.tagFindMany.mock.calls[0][0].select.items.where).toEqual({ packageId: { not: null } })
  })

  it('returns the index the list page renders from', async () => {
    await expect(listOfferingTags('trainer_1')).resolves.toEqual({
      order: [PUPPY.id],
      byPackage: { pkg_a: [PUPPY] },
    })
  })
})
