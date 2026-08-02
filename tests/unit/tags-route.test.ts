import { describe, it, expect, vi, beforeEach } from 'vitest'

// The tag list: naming one, renaming one, and — the one that matters — what a
// delete actually removes.
//
// Two tags called "Puppy" splits the browse screen in two and there is no way
// back from it once things are filed under both, so the duplicate check is
// case-INSENSITIVE and is checked here in both directions. And deleting a tag
// must take the label and nothing else: a trainer tidying their words must not
// discover they have unpublished a course.
const h = vi.hoisted(() => ({
  guardAnyPermission: vi.fn(),
  tagFindMany: vi.fn(),
  tagFindFirst: vi.fn(),
  tagCount: vi.fn(),
  tagCreate: vi.fn(),
  tagUpdate: vi.fn(),
  tagDelete: vi.fn(),
  assignmentDeleteMany: vi.fn(),
  packageDelete: vi.fn(),
  packageUpdateMany: vi.fn(),
  productDelete: vi.fn(),
  productUpdateMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  guardPermission: vi.fn(),
  guardAnyPermission: h.guardAnyPermission,
}))

vi.mock('@/lib/prisma', () => {
  const client = {
    tag: {
      findMany: h.tagFindMany,
      findFirst: h.tagFindFirst,
      count: h.tagCount,
      create: h.tagCreate,
      update: h.tagUpdate,
      delete: h.tagDelete,
    },
    tagAssignment: { deleteMany: h.assignmentDeleteMany },
    package: { delete: h.packageDelete, updateMany: h.packageUpdateMany },
    product: { delete: h.productDelete, updateMany: h.productUpdateMany },
    $transaction: (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client),
  }
  return { prisma: client }
})

import { POST as createTag } from '@/app/api/tags/route'
import { DELETE as removeTag, PATCH as renameTag } from '@/app/api/tags/[tagId]/route'
import { normalizeTagName, tagNameKey } from '@/lib/tags'

const TRAINER = 'trainer_1'
const TAG = 'tag_1'

const post = (body: unknown) =>
  createTag(new Request('https://app.pupmanager.com/api/tags', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const patch = (body: unknown, tagId = TAG) =>
  renameTag(
    new Request(`https://app.pupmanager.com/api/tags/${tagId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tagId }) },
  )

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.guardAnyPermission.mockResolvedValue({ companyId: TRAINER, role: 'OWNER' })
  h.tagFindFirst.mockResolvedValue(null)
  h.tagFindMany.mockResolvedValue([])
  h.tagCount.mockResolvedValue(0)
  h.tagCreate.mockImplementation(({ data }: { data: { name: string } }) => ({ id: TAG, order: 0, ...data }))
  h.tagUpdate.mockImplementation(({ data }: { data: object }) => ({ id: TAG, order: 0, ...data }))
  h.assignmentDeleteMany.mockResolvedValue({ count: 0 })
})

describe('name folding', () => {
  it('treats case and stray whitespace as the same tag', () => {
    expect(tagNameKey('Puppy')).toBe(tagNameKey(' puppy '))
    expect(tagNameKey('Loose  lead')).toBe(tagNameKey('loose lead'))
  })

  it('keeps the trainer’s capitals for display', () => {
    expect(normalizeTagName('  Puppy   School ')).toBe('Puppy School')
  })
})

describe('duplicate names are refused', () => {
  it('409s when the same word already exists in another case', async () => {
    h.tagFindFirst.mockResolvedValue({ id: 'tag_existing', name: 'Puppy' })

    const res = await post({ name: 'puppy' })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'You already have a “Puppy” tag.' })
    expect(h.tagCreate).not.toHaveBeenCalled()
  })

  it('looks the clash up on the folded key, scoped to this business', async () => {
    await post({ name: ' Loose  Lead ' })

    expect(h.tagFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: TRAINER, nameKey: 'loose lead' } }),
    )
    // Display keeps the capitals; the key is what uniqueness runs on.
    expect(h.tagCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Loose Lead', nameKey: 'loose lead' }),
      }),
    )
  })

  it('409s renaming one tag onto another’s name', async () => {
    // The route checks ownership first (found), then the clash (found).
    h.tagFindFirst
      .mockResolvedValueOnce({ id: TAG })
      .mockResolvedValueOnce({ id: 'tag_other', name: 'Puppy' })

    const res = await patch({ name: 'PUPPY' })

    expect(res.status).toBe(409)
    expect(h.tagUpdate).not.toHaveBeenCalled()
  })

  it('lets a tag keep its own name when only the capitals change', async () => {
    h.tagFindFirst
      .mockResolvedValueOnce({ id: TAG })
      // The clash lookup excludes this row, so nothing comes back.
      .mockResolvedValueOnce(null)

    const res = await patch({ name: 'Puppy' })

    expect(res.status).toBe(200)
    expect(h.tagFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { trainerId: TRAINER, nameKey: 'puppy', id: { not: TAG } },
      }),
    )
  })
})

describe('deleting a tag leaves what it tagged alone', () => {
  it('removes the join rows and the tag, and nothing else', async () => {
    h.tagFindFirst.mockResolvedValue({ id: TAG })
    h.assignmentDeleteMany.mockResolvedValue({ count: 3 })

    const res = await removeTag(
      new Request(`https://app.pupmanager.com/api/tags/${TAG}`, { method: 'DELETE' }),
      { params: Promise.resolve({ tagId: TAG }) },
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, untagged: 3 })

    // Only the label goes.
    expect(h.assignmentDeleteMany).toHaveBeenCalledWith({ where: { tagId: TAG } })
    expect(h.tagDelete).toHaveBeenCalledWith({ where: { id: TAG } })
    expect(h.packageDelete).not.toHaveBeenCalled()
    expect(h.productDelete).not.toHaveBeenCalled()
    expect(h.packageUpdateMany).not.toHaveBeenCalled()
    expect(h.productUpdateMany).not.toHaveBeenCalled()
  })

  it('renaming a tag moves nothing in or out of it', async () => {
    h.tagFindFirst.mockResolvedValueOnce({ id: TAG }).mockResolvedValueOnce(null)

    await patch({ name: 'Puppy school' })

    expect(h.assignmentDeleteMany).not.toHaveBeenCalled()
    expect(h.packageUpdateMany).not.toHaveBeenCalled()
    expect(h.productUpdateMany).not.toHaveBeenCalled()
  })
})
