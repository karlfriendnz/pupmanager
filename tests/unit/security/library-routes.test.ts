import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + ownership guards on the Library routes, plus the two new bits of
// behaviour the Library screens depend on:
//   • an item can carry an image + a PDF (imageUrl / fileUrl / fileName)
//   • assigning an item stamps TrainingTask.libraryTaskId, which is what the
//     item page's "who has this" list is built from
//
// Every route scopes Prisma through the item's own category
// (`type.trainerId`) or trainerId directly, so a trainer can only touch their
// own library. It is read off the item rather than through its theme because a
// theme is optional grouping now — a theme-less item has no chain to walk, and
// a filter with nothing to filter on is not a tenant check. We mock auth,
// permissions and Prisma and assert real status codes plus that no mutation
// happens cross-tenant.

const h = vi.hoisted(() => ({
  session: vi.fn(),
  guardOk: vi.fn(() => true),
  trainerFindUnique: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  taskDelete: vi.fn(),
  taskCreate: vi.fn(),
  taskAggregate: vi.fn(),
  themeFindFirst: vi.fn(),
  typeFindFirst: vi.fn(),
  trainingTaskCreate: vi.fn(),
  clientAccess: vi.fn(),
  dogBelongs: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: async () => h.session() }))
vi.mock('@/lib/membership', async () => {
  const { NextResponse } = await import('next/server')
  return {
    guardPermission: async () => {
      if (!h.guardOk()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return { userId: 'u1', companyId: 'trainer-a', membershipId: 'm1', role: 'OWNER', permissions: {} }
    },
  }
})
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: async (...a: unknown[]) => h.clientAccess(...a) }))
vi.mock('@/lib/dog-access', () => ({ dogBelongsToClient: async (...a: unknown[]) => h.dogBelongs(...a) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    libraryTask: {
      findFirst: h.taskFindFirst,
      update: h.taskUpdate,
      delete: h.taskDelete,
      create: h.taskCreate,
      aggregate: h.taskAggregate,
    },
    libraryTheme: { findFirst: h.themeFindFirst },
    libraryType: { findFirst: h.typeFindFirst },
    trainingTask: { create: h.trainingTaskCreate },
  },
}))

import { POST as createTask } from '@/app/api/library/tasks/route'
import { PATCH as patchTask, DELETE as deleteTask } from '@/app/api/library/tasks/[taskId]/route'
import { POST as assignTask } from '@/app/api/library/tasks/[taskId]/assign/route'

const TRAINER_SESSION = { user: { id: 'u1', role: 'TRAINER', trainerId: 'trainer-a' } }

const taskParams = (taskId: string) => ({ params: Promise.resolve({ taskId }) })
const jsonReq = (body: unknown, method = 'POST') =>
  new Request('https://app.pupmanager.com/api/library/tasks', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardOk.mockReturnValue(true)
  h.session.mockResolvedValue(TRAINER_SESSION)
  h.trainerFindUnique.mockResolvedValue({ id: 'trainer-a' })
  h.taskAggregate.mockResolvedValue({ _max: { order: 2 } })
  h.clientAccess.mockResolvedValue({ canEdit: true })
  h.dogBelongs.mockResolvedValue(true)
})

describe('library item media', () => {
  it('persists the image and PDF on create', async () => {
    h.themeFindFirst.mockResolvedValue({ id: 'theme-1', typeId: 'type-1' })
    h.taskCreate.mockResolvedValue({ id: 'task-1' })

    const res = await createTask(jsonReq({
      themeId: 'theme-1',
      title: 'Loose lead',
      imageUrl: 'https://blob.example.com/pic.jpg',
      fileUrl: 'https://blob.example.com/handout.pdf',
      fileName: 'handout.pdf',
    }))

    expect(res.status).toBe(201)
    expect(h.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        imageUrl: 'https://blob.example.com/pic.jpg',
        fileUrl: 'https://blob.example.com/handout.pdf',
        fileName: 'handout.pdf',
        order: 3,
      }),
    }))
  })

  it('persists the image and PDF on update, and clears them when emptied', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1' })
    h.taskUpdate.mockResolvedValue({ id: 'task-1' })

    await patchTask(
      jsonReq({ title: 'Loose lead', imageUrl: '', fileUrl: null, fileName: null }, 'PATCH'),
      taskParams('task-1'),
    )

    expect(h.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: null, fileUrl: null, fileName: null }),
    }))
  })

  it('keeps rich-text HTML in the description untouched', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1' })
    h.taskUpdate.mockResolvedValue({ id: 'task-1' })
    const html = '<p>Ask for a <strong>sit</strong>.</p><ul><li>Reward calm</li></ul>'

    await patchTask(jsonReq({ title: 'Sit', description: html }, 'PATCH'), taskParams('task-1'))

    expect(h.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: html }),
    }))
  })

  it('rejects a non-URL image', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1' })
    const res = await patchTask(
      jsonReq({ title: 'Sit', imageUrl: 'javascript:alert(1)' }, 'PATCH'),
      taskParams('task-1'),
    )
    expect(res.status).toBe(400)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })
})

describe('creating an item with no theme', () => {
  it('lands it directly in the category, with themeId null', async () => {
    h.typeFindFirst.mockResolvedValue({ id: 'type-1' })
    h.taskCreate.mockResolvedValue({ id: 'task-1' })

    const res = await createTask(jsonReq({ typeId: 'type-1', title: 'Sit at the kerb' }))

    expect(res.status).toBe(201)
    expect(h.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ typeId: 'type-1', themeId: null, title: 'Sit at the kerb' }),
    }))
    // A theme was never involved, so none was looked up.
    expect(h.themeFindFirst).not.toHaveBeenCalled()
  })

  it('orders it after the other LOOSE items, not after some theme\'s last item', async () => {
    h.typeFindFirst.mockResolvedValue({ id: 'type-1' })
    h.taskCreate.mockResolvedValue({ id: 'task-1' })

    await createTask(jsonReq({ typeId: 'type-1', title: 'Wait at the door' }))

    expect(h.taskAggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { typeId: 'type-1', themeId: null },
    }))
    expect(h.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ order: 3 }),
    }))
  })

  it('still records the category when a THEME is named — the item never has to walk up', async () => {
    h.themeFindFirst.mockResolvedValue({ id: 'theme-1', typeId: 'type-1' })
    h.taskCreate.mockResolvedValue({ id: 'task-1' })

    await createTask(jsonReq({ themeId: 'theme-1', title: 'Loose lead' }))

    expect(h.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ typeId: 'type-1', themeId: 'theme-1' }),
    }))
  })

  it('400s when neither a theme nor a category is given', async () => {
    const res = await createTask(jsonReq({ title: 'Nowhere' }))
    expect(res.status).toBe(400)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })
})

describe('library item tenant guards', () => {
  it('404s (and never writes) when the item belongs to another trainer', async () => {
    // The route's findFirst is scoped by theme.type.trainerId, so a foreign id
    // simply does not resolve.
    h.taskFindFirst.mockResolvedValue(null)

    const patched = await patchTask(jsonReq({ title: 'Hijack' }, 'PATCH'), taskParams('foreign-task'))
    expect(patched.status).toBe(404)
    expect(h.taskUpdate).not.toHaveBeenCalled()

    const deleted = await deleteTask(new Request('https://x/', { method: 'DELETE' }), taskParams('foreign-task'))
    expect(deleted.status).toBe(404)
    expect(h.taskDelete).not.toHaveBeenCalled()

    // …and the scoping is actually asked for.
    expect(h.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: { trainerId: 'trainer-a' } }),
    }))
  })

  it('404s when creating an item under another trainer\'s theme', async () => {
    h.themeFindFirst.mockResolvedValue(null)
    const res = await createTask(jsonReq({ themeId: 'foreign-theme', title: 'Hijack' }))
    expect(res.status).toBe(404)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })

  it('404s when creating an item straight into another trainer\'s category', async () => {
    // The theme-less path is a NEW way into someone's library, so it gets the
    // same guard: the category is looked up scoped to the caller, and a foreign
    // id simply does not resolve.
    h.typeFindFirst.mockResolvedValue(null)
    const res = await createTask(jsonReq({ typeId: 'foreign-type', title: 'Hijack' }))
    expect(res.status).toBe(404)
    expect(h.taskCreate).not.toHaveBeenCalled()
    expect(h.typeFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'foreign-type', trainerId: 'trainer-a' },
    }))
  })

  it('401s an unauthenticated caller', async () => {
    h.session.mockResolvedValue(null)
    const res = await patchTask(jsonReq({ title: 'Sit' }, 'PATCH'), taskParams('task-1'))
    expect(res.status).toBe(401)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })

  it('403s a member without the permission', async () => {
    h.guardOk.mockReturnValue(false)
    const res = await patchTask(jsonReq({ title: 'Sit' }, 'PATCH'), taskParams('task-1'))
    expect(res.status).toBe(403)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })
})

describe('assigning an item records where it came from', () => {
  it('stamps libraryTaskId so the item page can list who has it', async () => {
    h.taskFindFirst.mockResolvedValue({
      id: 'task-1', title: 'Sit and stay', description: '<p>Sit.</p>', repetitions: 5, videoUrl: null,
    })
    h.trainingTaskCreate.mockResolvedValue({ id: 'homework-1' })

    const res = await assignTask(
      jsonReq({ clientId: 'client-1', date: '2026-07-26' }),
      taskParams('task-1'),
    )

    expect(res.status).toBe(201)
    expect(h.trainingTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        libraryTaskId: 'task-1',
        clientId: 'client-1',
        // Still a snapshot: the text is copied, not referenced.
        title: 'Sit and stay',
        description: '<p>Sit.</p>',
      }),
    }))
  })

  it('refuses to assign another trainer\'s item', async () => {
    h.taskFindFirst.mockResolvedValue(null)
    const res = await assignTask(jsonReq({ clientId: 'client-1', date: '2026-07-26' }), taskParams('foreign'))
    expect(res.status).toBe(404)
    expect(h.trainingTaskCreate).not.toHaveBeenCalled()
  })

  it('refuses to assign to a client the caller cannot edit', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1', title: 'Sit', description: null, repetitions: null, videoUrl: null })
    h.clientAccess.mockResolvedValue({ canEdit: false })
    const res = await assignTask(jsonReq({ clientId: 'other-tenant-client', date: '2026-07-26' }), taskParams('task-1'))
    expect(res.status).toBe(403)
    expect(h.trainingTaskCreate).not.toHaveBeenCalled()
  })
})
