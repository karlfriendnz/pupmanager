import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on the routes that write a library item's MEDIA
// LIST, plus the two things that list must never get wrong:
//
//   • a media URL is trainer-typed and lands in <img src> / <a href> on a
//     CLIENT's screen, so `javascript:` must not survive the round trip —
//     ownership is not the only boundary here, the URL scheme is one too;
//   • the derived columns (videos / videoUrl / imageUrl / fileUrl / fileName)
//     must be written from the list on every save, because the default-homework
//     builder and the offering suggestion list still select them.
//
// Ownership on every one of these is two relations up — item → theme → type →
// trainer — so the mocks assert the Prisma WHERE as well as the status code: a
// route that returns 404 for the right reason and a route that returns 404
// because it queried unscoped look identical from the outside.

const h = vi.hoisted(() => ({
  session: vi.fn(),
  guardOk: vi.fn(() => true),
  trainerFindUnique: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  taskCreate: vi.fn(),
  taskAggregate: vi.fn(),
  themeFindFirst: vi.fn(),
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
      create: h.taskCreate,
      aggregate: h.taskAggregate,
    },
    libraryTheme: { findFirst: h.themeFindFirst },
    trainingTask: { create: h.trainingTaskCreate },
  },
}))

import { POST as createTask } from '@/app/api/library/tasks/route'
import { PATCH as patchTask } from '@/app/api/library/tasks/[taskId]/route'
import { POST as assignTask } from '@/app/api/library/tasks/[taskId]/assign/route'

const TRAINER_SESSION = { user: { id: 'u1', role: 'TRAINER', trainerId: 'trainer-a' } }

const V1 = 'https://blob.example.com/step-1.mp4'
const IMG = 'https://blob.example.com/pic.jpg'
const PDF = 'https://blob.example.com/handout.pdf'

const MEDIA = [
  { kind: 'video', url: V1, title: 'Step 1' },
  { kind: 'image', url: IMG },
  { kind: 'document', url: PDF, fileName: 'Handout.pdf' },
]

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

describe('PATCH /api/library/tasks/[taskId] — tenant guard', () => {
  it('scopes the lookup through the item’s own category — type → trainer', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1' })
    h.taskUpdate.mockResolvedValue({ id: 'task-1' })

    await patchTask(jsonReq({ title: 'Sit', media: MEDIA }, 'PATCH'), taskParams('task-1'))

    expect(h.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', type: { trainerId: 'trainer-a' } },
    }))
  })

  it('404s another trainer’s item and writes nothing', async () => {
    h.taskFindFirst.mockResolvedValue(null)

    const res = await patchTask(jsonReq({ title: 'Sit', media: MEDIA }, 'PATCH'), taskParams('theirs'))

    expect(res.status).toBe(404)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })

  it('403s without the forms.manage permission', async () => {
    h.guardOk.mockReturnValue(false)

    const res = await patchTask(jsonReq({ title: 'Sit', media: MEDIA }, 'PATCH'), taskParams('task-1'))

    expect(res.status).toBe(403)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })

  it('401s a CLIENT session', async () => {
    h.session.mockResolvedValue({ user: { id: 'u2', role: 'CLIENT' } })

    const res = await patchTask(jsonReq({ title: 'Sit', media: MEDIA }, 'PATCH'), taskParams('task-1'))

    expect(res.status).toBe(401)
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH — the list and its derived columns', () => {
  beforeEach(() => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1' })
    h.taskUpdate.mockResolvedValue({ id: 'task-1' })
  })

  it('writes the list AND every column derived from it', async () => {
    await patchTask(jsonReq({ title: 'Sit', media: MEDIA }, 'PATCH'), taskParams('task-1'))

    expect(h.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        media: MEDIA,
        videos: [{ url: V1, title: 'Step 1' }],
        videoUrl: V1,
        imageUrl: IMG,
        fileUrl: PDF,
        fileName: 'Handout.pdf',
      }),
    }))
  })

  it('clears every derived column when the list is emptied', async () => {
    await patchTask(jsonReq({ title: 'Sit', media: [] }, 'PATCH'), taskParams('task-1'))

    expect(h.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        media: [], videos: [], videoUrl: null, imageUrl: null, fileUrl: null, fileName: null,
      }),
    }))
  })

  // The trainer types these and a client opens them. A URL check that only asks
  // "does this parse" lets `javascript:` straight through to their app.
  it('drops a javascript: row instead of storing it', async () => {
    await patchTask(
      jsonReq({ title: 'Sit', media: [{ kind: 'link', url: 'javascript:alert(1)' }, { kind: 'image', url: IMG }] }, 'PATCH'),
      taskParams('task-1'),
    )

    const data = h.taskUpdate.mock.calls[0][0].data
    expect(data.media).toEqual([{ kind: 'image', url: IMG }])
    expect(JSON.stringify(data)).not.toContain('javascript:')
  })

  // A browser still holding the pre-list page through a rolling deploy sends
  // the separate fields. Ignoring them would wipe the trainer's attachments.
  it('folds a pre-list body into the list rather than blanking it', async () => {
    await patchTask(
      jsonReq({ title: 'Sit', imageUrl: IMG, fileUrl: PDF, fileName: 'Handout.pdf' }, 'PATCH'),
      taskParams('task-1'),
    )

    expect(h.taskUpdate.mock.calls[0][0].data.media).toEqual([
      { kind: 'image', url: IMG },
      { kind: 'document', url: PDF, fileName: 'Handout.pdf' },
    ])
  })
})

describe('POST /api/library/tasks — create', () => {
  it('refuses a theme belonging to another trainer', async () => {
    h.themeFindFirst.mockResolvedValue(null)

    const res = await createTask(jsonReq({ themeId: 'theirs', title: 'Sit', media: MEDIA }))

    expect(res.status).toBe(404)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })

  it('stores the list and its derived columns on a new item', async () => {
    h.themeFindFirst.mockResolvedValue({ id: 'theme-1' })
    h.taskCreate.mockResolvedValue({ id: 'task-1' })

    const res = await createTask(jsonReq({ themeId: 'theme-1', title: 'Sit', media: MEDIA }))

    expect(res.status).toBe(201)
    expect(h.taskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ media: MEDIA, imageUrl: IMG, fileUrl: PDF, order: 3 }),
    }))
  })
})

describe('POST /api/library/tasks/[taskId]/assign — the snapshot', () => {
  beforeEach(() => {
    h.trainingTaskCreate.mockResolvedValue({ id: 'hw-1' })
  })

  it('refuses to hand out another trainer’s item', async () => {
    h.taskFindFirst.mockResolvedValue(null)

    const res = await assignTask(
      jsonReq({ clientId: 'c1', date: '2026-08-03' }),
      taskParams('theirs'),
    )

    expect(res.status).toBe(404)
    expect(h.trainingTaskCreate).not.toHaveBeenCalled()
  })

  it('refuses a client the caller cannot edit', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1', title: 'Sit', media: MEDIA })
    h.clientAccess.mockResolvedValue({ canEdit: false })

    const res = await assignTask(
      jsonReq({ clientId: 'not-mine', date: '2026-08-03' }),
      taskParams('task-1'),
    )

    expect(res.status).toBe(403)
    expect(h.trainingTaskCreate).not.toHaveBeenCalled()
  })

  // The handout is the attachment that never reached a client: there was
  // nowhere on a TrainingTask to put a PDF, so a trainer who attached one
  // handed out homework that had silently lost it.
  it('copies EVERY attachment, handout included', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1', title: 'Sit', media: MEDIA, wantsLog: true })

    const res = await assignTask(
      jsonReq({ clientId: 'c1', date: '2026-08-03' }),
      taskParams('task-1'),
    )

    expect(res.status).toBe(201)
    expect(h.trainingTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        media: MEDIA,
        videos: [{ url: V1, title: 'Step 1' }],
        videoUrl: V1,
        imageUrls: [IMG],
        libraryTaskId: 'task-1',
      }),
    }))
  })

  // An item saved before the list existed has its attachments only in the old
  // columns. Assigning it must still hand all of them over.
  it('copies a pre-list item’s picture and handout', async () => {
    h.taskFindFirst.mockResolvedValue({
      id: 'task-1', title: 'Sit', media: [], videos: [], videoUrl: null,
      imageUrl: IMG, fileUrl: PDF, fileName: 'Handout.pdf', wantsLog: true,
    })

    await assignTask(jsonReq({ clientId: 'c1', date: '2026-08-03' }), taskParams('task-1'))

    expect(h.trainingTaskCreate.mock.calls[0][0].data.media).toEqual([
      { kind: 'image', url: IMG },
      { kind: 'document', url: PDF, fileName: 'Handout.pdf' },
    ])
  })
})
