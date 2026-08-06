import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A picture on a TAG — and the save that must not take it away.
 *
 * Settings → Tags has always had a rename control that sends `{ name }` and
 * nothing else. The moment a tag gained a picture, that rename became the exact
 * shape of the bug this codebase has written twice: a patch that omits a key and
 * blanks it. So the schema treats an ABSENT `imageUrl` as "leave it alone" and
 * only an explicit `null` as "clear it", and both directions are pinned here.
 *
 * The fake tags row below is real state: a "reload" re-reads what the route
 * actually wrote, which is the only proof worth having.
 */

const h = vi.hoisted(() => ({
  guardAnyPermission: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  guardPermission: vi.fn(),
  guardAnyPermission: h.guardAnyPermission,
}))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: {
      findFirst: h.findFirst,
      findMany: h.findMany,
      count: h.count,
      create: h.create,
      update: h.update,
    },
  },
}))

import { PATCH } from '@/app/api/tags/[tagId]/route'
import { POST } from '@/app/api/tags/route'

const TRAINER = 'trainer_1'
const OTHER_TRAINER = 'trainer_2'
const TAG = 'tag_1'
const PIC = 'https://blob.example.com/puppy.jpg'
const NEW_PIC = 'https://blob.example.com/puppy-2.jpg'

/** The stored row, as a database would hold it. */
let row: { id: string; name: string; nameKey: string; order: number; imageUrl: string | null }

beforeEach(() => {
  vi.clearAllMocks()
  h.revalidatePath.mockReset()
  row = { id: TAG, name: 'Puppy', nameKey: 'puppy', order: 0, imageUrl: null }
  h.guardAnyPermission.mockResolvedValue({ companyId: TRAINER })
  // Two callers: the ownership lookup (by id + trainerId) and the duplicate-name
  // check. Only the first should ever match our one row.
  h.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.id === TAG && where.trainerId === TRAINER) return { id: TAG }
    return null
  })
  h.count.mockResolvedValue(0)
  h.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    // Only the keys the route actually put in `data` are written. A key it left
    // out keeps whatever was in the column — which is the whole question.
    Object.assign(row, data)
    return { id: row.id, name: row.name, order: row.order, imageUrl: row.imageUrl }
  })
  h.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'tag_new', name: data.name, order: data.order, imageUrl: data.imageUrl ?? null,
  }))
})

const patch = (body: unknown, tagId = TAG) =>
  PATCH(
    new Request(`https://app.pupmanager.com/api/tags/${tagId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tagId }) },
  )

const post = (body: unknown) =>
  POST(new Request('https://app.pupmanager.com/api/tags', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

describe('a tag’s picture survives a reload', () => {
  it('is still there after save → reload', async () => {
    const res = await patch({ imageUrl: PIC })
    expect(res.status).toBe(200)
    expect(row.imageUrl).toBe(PIC)
    expect(await res.json()).toMatchObject({ imageUrl: PIC })
  })

  /**
   * THE BUG. The rename control on Settings → Tags sends `{ name }` alone, and
   * has done since long before pictures existed.
   */
  it('is still there after a rename that never mentioned it', async () => {
    await patch({ imageUrl: PIC })
    expect(row.imageUrl).toBe(PIC)

    const res = await patch({ name: 'Puppies' })
    expect(res.status).toBe(200)

    // The name landed…
    expect(row.name).toBe('Puppies')
    // …and the picture is exactly where it was.
    expect(row.imageUrl).toBe(PIC)
    // Not even mentioned in the write — "absent" has to mean absent all the way
    // down, or a future default on the column would quietly overwrite it.
    expect(h.update.mock.calls[1][0].data).not.toHaveProperty('imageUrl')
  })

  it('can be replaced without touching the name', async () => {
    await patch({ imageUrl: PIC })
    await patch({ imageUrl: NEW_PIC })
    expect(row.imageUrl).toBe(NEW_PIC)
    expect(row.name).toBe('Puppy')
    expect(h.update.mock.calls[1][0].data).not.toHaveProperty('name')
  })

  it('is set at the moment the tag is named', async () => {
    const res = await post({ name: 'Reactivity', imageUrl: PIC })
    expect(res.status).toBe(201)
    expect(h.create.mock.calls[0][0].data.imageUrl).toBe(PIC)
  })
})

describe('clearing a tag’s picture', () => {
  // Explicit null, and distinguishable from not-sent: only this removes it.
  it('removes it when imageUrl is sent as null', async () => {
    await patch({ imageUrl: PIC })
    const res = await patch({ imageUrl: null })
    expect(res.status).toBe(200)
    expect(row.imageUrl).toBeNull()
  })

  it('removes it alongside a rename in the same save', async () => {
    await patch({ imageUrl: PIC })
    await patch({ name: 'Puppies', imageUrl: null })
    expect(row.name).toBe('Puppies')
    expect(row.imageUrl).toBeNull()
  })

  // Cleared means the client's row goes back to borrowing one off the first
  // thing in the tag — the fallback was overridden, never deleted.
  it('leaves nothing behind for the client row to prefer', async () => {
    await patch({ imageUrl: PIC })
    await patch({ imageUrl: null })
    expect(row.imageUrl ?? 'borrow').toBe('borrow')
  })

  it('refuses a body that changes nothing at all', async () => {
    const res = await patch({})
    expect(res.status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('what a tag’s picture may be', () => {
  // The URL is stored and then rendered into an <img src> on a CLIENT's screen.
  // A form usually sends what our uploader returned; anyone can send anything.
  it('stores nothing for a URL that isn’t http(s)', async () => {
    await patch({ imageUrl: 'javascript:alert(1)' })
    expect(row.imageUrl).toBeNull()
  })

  it('stores nothing for a relative path', async () => {
    await patch({ imageUrl: '/uploads/x.jpg' })
    expect(row.imageUrl).toBeNull()
  })

  it('refuses an absurdly long one outright', async () => {
    const res = await patch({ imageUrl: `https://x.example.com/${'a'.repeat(4000)}.jpg` })
    expect(res.status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('sanitizes on create too', async () => {
    await post({ name: 'Reactivity', imageUrl: 'javascript:alert(1)' })
    expect(h.create.mock.calls[0][0].data.imageUrl).toBeNull()
  })
})

describe('whose tag it is', () => {
  // The ownership guard. A trainer must not be able to put a picture on another
  // business's tag — the id resolves to nothing under their own companyId.
  it('404s a tag belonging to another business', async () => {
    h.guardAnyPermission.mockResolvedValue({ companyId: OTHER_TRAINER })
    const res = await patch({ imageUrl: PIC })
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
    expect(row.imageUrl).toBeNull()
  })

  it('404s before it even looks at the body', async () => {
    h.guardAnyPermission.mockResolvedValue({ companyId: OTHER_TRAINER })
    const res = await patch({ name: 'Stolen', imageUrl: PIC })
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses anyone without either catalogue permission', async () => {
    const { NextResponse } = await import('next/server')
    h.guardAnyPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await patch({ imageUrl: PIC })
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup to the caller’s own business', async () => {
    await patch({ imageUrl: PIC })
    expect(h.findFirst.mock.calls[0][0].where).toMatchObject({ id: TAG, trainerId: TRAINER })
  })
})

describe('the client screen sees it', () => {
  it('clears the booking screen’s cached render', async () => {
    await patch({ imageUrl: PIC })
    expect(h.revalidatePath.mock.calls.map(c => c[0])).toContain('/my-availability')
  })

  // The tag has already saved. A throw from revalidation would report a
  // successful save as failed and invite the trainer to do it again.
  it('still answers 200 when revalidatePath throws', async () => {
    h.revalidatePath.mockImplementation(() => { throw new Error('no such route') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await patch({ imageUrl: PIC })
    expect(res.status).toBe(200)
    expect(row.imageUrl).toBe(PIC)
    err.mockRestore()
  })
})
