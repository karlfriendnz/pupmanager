import { describe, it, expect, vi, beforeEach } from 'vitest'

// Super-admin internal notes + to-dos per trainer. Guarded to ADMIN; writes are
// stamped with the admin's id.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  noteCreate: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminTrainerNote: { create: h.noteCreate },
    adminTrainerTask: { create: h.taskCreate, updateMany: h.taskUpdateMany },
  },
}))

import { POST as POST_NOTE } from '@/app/api/admin/trainer-notes/route'
import { POST as POST_TASK } from '@/app/api/admin/trainer-tasks/route'
import { PATCH as PATCH_TASK } from '@/app/api/admin/trainer-tasks/[id]/route'

const admin = { user: { id: 'admin_1', role: 'ADMIN' } }
const trainer = { user: { id: 'u1', role: 'TRAINER' } }
const req = (body: unknown) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.noteCreate.mockResolvedValue({ id: 'n1' })
  h.taskCreate.mockResolvedValue({ id: 't1' })
  h.taskUpdateMany.mockResolvedValue({ count: 1 })
})

describe('admin guard', () => {
  it('non-admin cannot add a note', async () => {
    h.auth.mockResolvedValue(trainer)
    expect((await POST_NOTE(req({ trainerId: 'tp1', body: 'hi' }))).status).toBe(401)
    expect(h.noteCreate).not.toHaveBeenCalled()
  })
  it('non-admin cannot add a task', async () => {
    h.auth.mockResolvedValue(trainer)
    expect((await POST_TASK(req({ trainerId: 'tp1', title: 'do' }))).status).toBe(401)
  })
  it('unauthenticated cannot toggle a task', async () => {
    h.auth.mockResolvedValue(null)
    expect((await PATCH_TASK(new Request('https://x', { method: 'PATCH', body: '{"done":true}' }), params('t1'))).status).toBe(401)
  })
})

describe('admin writes', () => {
  beforeEach(() => h.auth.mockResolvedValue(admin))

  it('adds a note stamped with the admin id', async () => {
    const res = await POST_NOTE(req({ trainerId: 'tp1', body: 'Trial going well' }))
    expect(res.status).toBe(201)
    expect(h.noteCreate.mock.calls[0][0].data).toMatchObject({ trainerId: 'tp1', body: 'Trial going well', createdById: 'admin_1' })
  })

  it('rejects an empty note', async () => {
    const res = await POST_NOTE(req({ trainerId: 'tp1', body: '   ' }))
    expect(res.status).toBe(400)
    expect(h.noteCreate).not.toHaveBeenCalled()
  })

  it('adds a to-do', async () => {
    const res = await POST_TASK(req({ trainerId: 'tp1', title: 'Follow up on billing' }))
    expect(res.status).toBe(201)
    expect(h.taskCreate.mock.calls[0][0].data).toMatchObject({ trainerId: 'tp1', title: 'Follow up on billing', createdById: 'admin_1' })
  })

  it('ticking a to-do stamps completedAt; unticking clears it', async () => {
    await PATCH_TASK(new Request('https://x', { method: 'PATCH', body: '{"done":true}' }), params('t1'))
    expect(h.taskUpdateMany.mock.calls[0][0].data.done).toBe(true)
    expect(h.taskUpdateMany.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date)

    await PATCH_TASK(new Request('https://x', { method: 'PATCH', body: '{"done":false}' }), params('t1'))
    expect(h.taskUpdateMany.mock.calls[1][0].data.completedAt).toBeNull()
  })
})
