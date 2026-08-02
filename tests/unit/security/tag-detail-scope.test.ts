import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant scoping on "what is in this tag?".
//
// The screen takes a tag id straight off the URL and answers it with a list of
// the business's courses, sessions and stock. That is exactly the shape of
// request that leaks a competitor's catalogue if either end is trusted, so both
// ends are checked and both are asserted here:
//
//   1. the TAG is re-read against the signed-in business — another trainer's id
//      is a 404, not an empty screen (an empty screen would confirm the id
//      exists and merely holds nothing);
//   2. the ITEMS are read from the package and product ends with their own
//      `trainerId` in the where, so the tag lookup is not the only thing
//      standing between one business's tag and another's catalogue.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  // Both of these THROW in Next, which is the only reason the guards above them
  // are guards at all — a mock that merely records the call would let the rest
  // of the page run and quietly pass a test the real thing would fail.
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  tagFindFirst: vi.fn(),
  packageFindMany: vi.fn(),
  productFindMany: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: { findFirst: h.tagFindFirst },
    package: { findMany: h.packageFindMany },
    product: { findMany: h.productFindMany },
  },
}))

import TagPage from '@/app/(trainer)/offerings/tags/[tagId]/page'

const MINE = 'trainer_mine'
const TAG = 'tag_1'

const open = (tagId = TAG) => TagPage({ params: Promise.resolve({ tagId }) })

beforeEach(() => {
  h.auth.mockReset()
  h.redirect.mockReset()
  h.notFound.mockClear()
  h.tagFindFirst.mockReset()
  h.packageFindMany.mockReset()
  h.productFindMany.mockReset()

  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: MINE } })
  h.tagFindFirst.mockResolvedValue({ id: TAG, name: 'Puppy' })
  h.packageFindMany.mockResolvedValue([])
  h.productFindMany.mockResolvedValue([])
})

describe('a tag detail screen only ever opens its own business’s tag', () => {
  it('looks the tag up scoped to the signed-in business', async () => {
    await open()
    expect(h.tagFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TAG, trainerId: MINE } }),
    )
  })

  it('404s a tag id belonging to another business, before reading anything', async () => {
    // Scoped lookup finds nothing, because it isn't theirs.
    h.tagFindFirst.mockResolvedValue(null)
    await expect(open('tag_of_a_competitor')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalled()
    // And nothing about anyone's catalogue was read on the way to saying no.
    expect(h.packageFindMany).not.toHaveBeenCalled()
    expect(h.productFindMany).not.toHaveBeenCalled()
  })

  it('reads the offerings in the tag scoped to the business as well as to the tag', async () => {
    await open()
    expect(h.packageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trainerId: MINE, tags: { some: { tagId: TAG } } },
      }),
    )
  })

  it('reads the products in the tag the same way', async () => {
    await open()
    expect(h.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trainerId: MINE, tags: { some: { tagId: TAG } } },
      }),
    )
  })

  it('sends a signed-out visitor to the login screen', async () => {
    h.auth.mockResolvedValue(null)
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.redirect).toHaveBeenCalledWith('/login')
    expect(h.tagFindFirst).not.toHaveBeenCalled()
  })

  it('sends a client-role visitor to the login screen', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', trainerId: null } })
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.redirect).toHaveBeenCalledWith('/login')
    expect(h.tagFindFirst).not.toHaveBeenCalled()
  })

  // A staff member signed in with no business attached must not fall through to
  // a `trainerId: null` query, which scopes to nothing and would 404 by luck.
  it('sends a trainer with no business to the login screen', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: null } })
    await expect(open()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.tagFindFirst).not.toHaveBeenCalled()
  })
})

describe('what the screen puts in front of the trainer', () => {
  it('shows offerings and products together, each linked to its own editor', async () => {
    h.packageFindMany.mockResolvedValue([{
      id: 'pkg_1', name: 'Puppy Foundations', priceCents: 24000, specialPriceCents: null,
      durationMins: 60, sessionCount: 6,
      isGroup: true, isEvent: false, isPuppySchool: false, allowDropIn: false, isSeries: false,
    }])
    h.productFindMany.mockResolvedValue([{
      id: 'prod_1', name: 'Clicker', priceCents: 1500, salePriceCents: null, active: true,
    }])

    const el = await open() as { props: { children: { props: { items: unknown[] } }[] } }
    const items = el.props.children[1].props.items as {
      key: string; kind: string; href: string; priceCents: number | null
    }[]

    expect(items.map(i => i.key)).toEqual(['package:pkg_1', 'product:prod_1'])
    // A group class's tag lives on its PACKAGE, so the row goes to the package
    // editor — the one screen that carries the Tags field.
    expect(items[0]).toMatchObject({ kind: 'class', href: '/packages/pkg_1/edit', priceCents: 24000 })
    expect(items[1]).toMatchObject({ kind: 'product', href: '/products/prod_1', priceCents: 1500 })
  })

  it('quotes the price actually charged, not the one crossed out', async () => {
    h.packageFindMany.mockResolvedValue([{
      id: 'pkg_1', name: 'Recall', priceCents: 20000, specialPriceCents: 15000,
      durationMins: 45, sessionCount: 1,
      isGroup: false, isEvent: false, isPuppySchool: false, allowDropIn: false, isSeries: false,
    }])
    h.productFindMany.mockResolvedValue([{
      id: 'prod_1', name: 'Long line', priceCents: 4000, salePriceCents: 2500, active: false,
    }])

    const el = await open() as { props: { children: { props: { items: unknown[] } }[] } }
    const items = el.props.children[1].props.items as {
      kind: string; priceCents: number | null; sub: string | null
    }[]

    expect(items[0]).toMatchObject({ kind: 'onetoone', priceCents: 15000, sub: '45 min' })
    // A product switched off is still in the tag, and the row says so rather
    // than quietly looking like the ones clients can buy.
    expect(items[1]).toMatchObject({ priceCents: 2500, sub: 'Not on sale' })
  })

  it('names a series on the row rather than giving it a section of its own', async () => {
    h.packageFindMany.mockResolvedValue([{
      id: 'pkg_1', name: 'Six weeks to calm', priceCents: 30000, specialPriceCents: null,
      durationMins: 50, sessionCount: 6,
      isGroup: false, isEvent: false, isPuppySchool: false, allowDropIn: false, isSeries: true,
    }])

    const el = await open() as { props: { children: { props: { items: unknown[] } }[] } }
    const items = el.props.children[1].props.items as { kind: string; sub: string | null }[]

    // A series lives on the 1:1 Sessions list (see offeringListHref), so a
    // "Series" heading here would name a place the trainer cannot go.
    expect(items[0].kind).toBe('onetoone')
    expect(items[0].sub).toBe('Series · 50 min · 6 sessions')
  })
})
