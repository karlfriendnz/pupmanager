import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant scoping on tags.
//
// A tag is one trainer's word for their own catalogue, and the join table it
// writes has TWO foreign keys pointing at rows a request could name freely. So
// both ends are checked against the signed-in business on every call: a tag id
// from another trainer must not attach, and a package or product id from
// another trainer must not be tagged. Getting either wrong would put one
// business's label on a competitor's course — and show it in that competitor's
// client app, under a tag they never made.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  guardAnyPermission: vi.fn(),
  packageFindFirst: vi.fn(),
  productFindFirst: vi.fn(),
  tagFindMany: vi.fn(),
  tagFindFirst: vi.fn(),
  tagCount: vi.fn(),
  tagUpdate: vi.fn(),
  tagDelete: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  assignmentCreateMany: vi.fn(),
  assignmentFindMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  guardPermission: h.guardPermission,
  guardAnyPermission: h.guardAnyPermission,
}))

vi.mock('@/lib/prisma', () => {
  const client = {
    package: { findFirst: h.packageFindFirst },
    product: { findFirst: h.productFindFirst },
    tag: {
      findMany: h.tagFindMany,
      findFirst: h.tagFindFirst,
      count: h.tagCount,
      update: h.tagUpdate,
      delete: h.tagDelete,
    },
    tagAssignment: {
      deleteMany: h.assignmentDeleteMany,
      createMany: h.assignmentCreateMany,
      findMany: h.assignmentFindMany,
    },
    // Both call styles are used: tags.ts batches an array, the delete route
    // takes a callback.
    $transaction: (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client),
  }
  return { prisma: client }
})

import { GET as assignGet, PUT as assignPut } from '@/app/api/tags/assign/route'
import { DELETE as tagDelete, PATCH as tagPatch } from '@/app/api/tags/[tagId]/route'
import { POST as reorder } from '@/app/api/tags/reorder/route'

const MINE = 'trainer_mine'
const TAG = 'tag_1'

const put = (body: unknown) =>
  assignPut(new Request('https://app.pupmanager.com/api/tags/assign', {
    method: 'PUT',
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.guardPermission.mockResolvedValue({ companyId: MINE, role: 'OWNER' })
  h.guardAnyPermission.mockResolvedValue({ companyId: MINE, role: 'OWNER' })
  h.assignmentDeleteMany.mockResolvedValue({ count: 0 })
  h.assignmentCreateMany.mockResolvedValue({ count: 0 })
  h.assignmentFindMany.mockResolvedValue([])
  h.tagFindMany.mockResolvedValue([])
})

describe('a tag cannot be attached to another trainer’s offering', () => {
  it('404s and writes nothing when the package belongs to someone else', async () => {
    // Scoped lookup finds nothing — which is what "someone else's package"
    // looks like from inside this business.
    h.packageFindFirst.mockResolvedValue(null)

    const res = await put({ packageId: 'pkg_theirs', tagIds: [TAG] })

    expect(res.status).toBe(404)
    expect(h.assignmentDeleteMany).not.toHaveBeenCalled()
    expect(h.assignmentCreateMany).not.toHaveBeenCalled()
  })

  it('404s and writes nothing when the product belongs to someone else', async () => {
    h.productFindFirst.mockResolvedValue(null)

    const res = await put({ productId: 'prod_theirs', tagIds: [TAG] })

    expect(res.status).toBe(404)
    expect(h.assignmentCreateMany).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup to the signed-in business', async () => {
    h.packageFindFirst.mockResolvedValue({ id: 'pkg_mine' })
    h.tagFindMany.mockResolvedValue([{ id: TAG }])

    await put({ packageId: 'pkg_mine', tagIds: [TAG] })

    expect(h.packageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pkg_mine', trainerId: MINE } }),
    )
  })

  it('drops a tag id belonging to another trainer instead of attaching it', async () => {
    h.packageFindFirst.mockResolvedValue({ id: 'pkg_mine' })
    // Only one of the two ids comes back from the trainer-scoped lookup.
    h.tagFindMany.mockResolvedValue([{ id: TAG }])

    const res = await put({ packageId: 'pkg_mine', tagIds: [TAG, 'tag_theirs'] })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tagIds: [TAG] })
    expect(h.assignmentCreateMany).toHaveBeenCalledWith({
      data: [{ tagId: TAG, packageId: 'pkg_mine' }],
    })
  })

  it('reads back another trainer’s tags as a 404, not as their list', async () => {
    h.productFindFirst.mockResolvedValue(null)

    const res = await assignGet(
      new Request('https://app.pupmanager.com/api/tags/assign?productId=prod_theirs'),
    )

    expect(res.status).toBe(404)
    expect(h.assignmentFindMany).not.toHaveBeenCalled()
  })

  it('refuses a target that names both a package and a product', async () => {
    const res = await put({ packageId: 'p1', productId: 'p2', tagIds: [] })
    expect(res.status).toBe(400)
    expect(h.packageFindFirst).not.toHaveBeenCalled()
  })
})

describe('the tag itself is tenant scoped', () => {
  it('404s renaming another trainer’s tag', async () => {
    h.tagFindFirst.mockResolvedValue(null)

    const res = await tagPatch(
      new Request('https://app.pupmanager.com/api/tags/tag_theirs', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Mine now' }),
      }),
      { params: Promise.resolve({ tagId: 'tag_theirs' }) },
    )

    expect(res.status).toBe(404)
    expect(h.tagUpdate).not.toHaveBeenCalled()
  })

  it('404s deleting another trainer’s tag', async () => {
    h.tagFindFirst.mockResolvedValue(null)

    const res = await tagDelete(
      new Request('https://app.pupmanager.com/api/tags/tag_theirs', { method: 'DELETE' }),
      { params: Promise.resolve({ tagId: 'tag_theirs' }) },
    )

    expect(res.status).toBe(404)
    expect(h.tagDelete).not.toHaveBeenCalled()
  })

  it('404s a reorder that slips in an id from another business', async () => {
    // Two ids sent, only one is this trainer's.
    h.tagCount.mockResolvedValue(1)

    const res = await reorder(
      new Request('https://app.pupmanager.com/api/tags/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: [TAG, 'tag_theirs'] }),
      }),
    )

    expect(res.status).toBe(404)
    expect(h.tagUpdate).not.toHaveBeenCalled()
  })
})
