import { describe, it, expect, vi, beforeEach } from 'vitest'

// The SECOND path that hands a library item to a client: "add from library"
// inside a session, which POSTs /api/tasks rather than the library's own assign
// route. It copied the fields and recorded nothing about where they came from,
// so the item page's "who has this" list could only fall back to matching on
// the exact title — a match that stops being true the moment the item is
// renamed, silently losing everyone who already had it.
//
// The route now accepts an optional `libraryTaskId` and stamps it, with the
// same ownership check the library assign route makes: the id must resolve to
// an item in the caller's own library, or it is not written. Provenance is a
// back-link, never a way to reference someone else's library.
const h = vi.hoisted(() => ({
  session: vi.fn(),
  clientAccess: vi.fn(),
  dogBelongs: vi.fn(),
  libraryTaskFindFirst: vi.fn(),
  sessionFindFirst: vi.fn(),
  taskAggregate: vi.fn(),
  taskCreate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: async () => h.session() }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: async (...a: unknown[]) => h.clientAccess(...a) }))
vi.mock('@/lib/dog-access', () => ({ dogBelongsToClient: async (...a: unknown[]) => h.dogBelongs(...a) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    libraryTask: { findFirst: h.libraryTaskFindFirst },
    trainingSession: { findFirst: h.sessionFindFirst },
    trainingTask: { aggregate: h.taskAggregate, create: h.taskCreate },
  },
}))

import { POST } from '@/app/api/tasks/route'

const post = (body: unknown) =>
  POST(new Request('https://app.pupmanager.com/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))

const ATTACH = {
  clientId: 'client-1',
  sessionId: 'sess-1',
  date: '2026-07-27',
  title: 'Loose-lead down the driveway',
  description: '<p>Ten minutes, low distraction.</p>',
  repetitions: 5,
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.session.mockResolvedValue({ user: { id: 'u1', role: 'TRAINER', trainerId: 'trainer-a' } })
  h.clientAccess.mockResolvedValue({ canEdit: true, trainerId: 'trainer-a' })
  h.dogBelongs.mockResolvedValue(true)
  h.sessionFindFirst.mockResolvedValue({ id: 'sess-1' })
  h.taskAggregate.mockResolvedValue({ _max: { order: 1 } })
  h.taskCreate.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'homework-1', ...(data as object) }))
})

const createdData = () => h.taskCreate.mock.calls[0][0].data

describe('attaching a library item to a session records which item it was', () => {
  it('stamps libraryTaskId when the item is the caller\'s', async () => {
    h.libraryTaskFindFirst.mockResolvedValue({ id: 'lib-1' })

    const res = await post({ ...ATTACH, libraryTaskId: 'lib-1' })

    expect(res.status).toBe(201)
    expect(createdData().libraryTaskId).toBe('lib-1')
    // The row is still a SNAPSHOT — the text is copied, not referenced, so
    // editing the library item never rewrites homework already handed out.
    expect(createdData().title).toBe(ATTACH.title)
    expect(createdData().description).toBe(ATTACH.description)
  })

  // The whole point: the link is an id, so the item can be renamed afterwards
  // and the holder is still found. Title matching cannot do this.
  it('scopes the ownership check to the caller\'s own library', async () => {
    h.libraryTaskFindFirst.mockResolvedValue({ id: 'lib-1' })
    await post({ ...ATTACH, libraryTaskId: 'lib-1' })

    expect(h.libraryTaskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lib-1', type: { trainerId: 'trainer-a' } },
    }))
  })

  // A back-link is not worth failing a save over, and it must never point at
  // another trainer's library — so an id that doesn't resolve is dropped and
  // the homework is still created.
  it('drops an id that is not this trainer\'s, and still creates the task', async () => {
    h.libraryTaskFindFirst.mockResolvedValue(null)

    const res = await post({ ...ATTACH, libraryTaskId: 'someone-elses-item' })

    expect(res.status).toBe(201)
    expect(createdData().libraryTaskId).toBeNull()
    expect(createdData().title).toBe(ATTACH.title)
  })

  it('leaves it null for a custom task typed by hand', async () => {
    const res = await post(ATTACH)

    expect(res.status).toBe(201)
    expect(createdData().libraryTaskId).toBeNull()
    // No id sent = nothing to look up.
    expect(h.libraryTaskFindFirst).not.toHaveBeenCalled()
  })

  it('still refuses a client the caller cannot edit, id or not', async () => {
    h.clientAccess.mockResolvedValue({ canEdit: false, trainerId: 'trainer-a' })
    const res = await post({ ...ATTACH, libraryTaskId: 'lib-1' })
    expect(res.status).toBe(403)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })

  it('still refuses a session belonging to someone else', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await post({ ...ATTACH, libraryTaskId: 'lib-1' })
    expect(res.status).toBe(400)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })
})
