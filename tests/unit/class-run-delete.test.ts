import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mock handles (vi.mock is hoisted, so build them via vi.hoisted).
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  notifyClient: vi.fn(),
  runFindFirst: vi.fn(),
  runDelete: vi.fn(),
  runUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/class-runs', () => ({
  updateClass: vi.fn(),
  ClassError: class ClassError extends Error {},
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classRun: { findFirst: h.runFindFirst, delete: h.runDelete, update: h.runUpdate, findUnique: vi.fn() },
    trainingSession: { deleteMany: h.sessionDeleteMany },
    classEnrollment: { findMany: h.enrollmentFindMany },
    $transaction: h.transaction,
  },
}))

import { DELETE } from '@/app/api/class-runs/[runId]/route'

const TRAINER = 'co1'
const RUN = 'run1'

function call(runId = RUN) {
  return DELETE(new Request('https://app.pupmanager.com/api/class-runs/' + runId, { method: 'DELETE' }), {
    params: Promise.resolve({ runId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ trainerId: TRAINER, role: 'OWNER', permissions: [] })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER } })
  h.runFindFirst.mockResolvedValue({ id: RUN, name: 'Spring Puppy Class' })
  h.enrollmentFindMany.mockResolvedValue([])
  h.sessionDeleteMany.mockResolvedValue({ count: 6 })
  h.runDelete.mockResolvedValue({ id: RUN })
  h.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
  h.notifyClient.mockResolvedValue(undefined)
})

describe('DELETE /api/class-runs/[runId] — deleting a class', () => {
  it('hard-deletes the class AND its sessions in one transaction', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: true })

    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { classRunId: RUN, trainerId: TRAINER } })
    expect(h.runDelete).toHaveBeenCalledWith({ where: { id: RUN } })
    expect(h.transaction).toHaveBeenCalledTimes(1)
    // The old bug: it flipped status to CANCELLED and left everything behind.
    expect(h.runUpdate).not.toHaveBeenCalled()
  })

  it('still deletes a class that HAS enrolments (the reported bug: it only got cancelled)', async () => {
    h.enrollmentFindMany.mockResolvedValue([
      { client: { userId: 'u1' }, dog: { name: 'Bailey' } },
      { client: { userId: 'u2' }, dog: { name: 'Rex' } },
    ])
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: true })
    expect(h.runDelete).toHaveBeenCalledWith({ where: { id: RUN } })
    expect(h.sessionDeleteMany).toHaveBeenCalledOnce()
    expect(h.runUpdate).not.toHaveBeenCalled()
  })

  it('notifies every enrolled client that the class is cancelled, before deleting', async () => {
    h.enrollmentFindMany.mockResolvedValue([
      { client: { userId: 'u1' }, dog: { name: 'Bailey' } },
      { client: { userId: null }, dog: { name: 'Ghost' } }, // no user → skipped
    ])
    await call()
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', trainerId: TRAINER, type: 'CLIENT_SESSION_CHANGED' }),
    )
  })

  it('deletes anyway when the client notification blows up', async () => {
    h.enrollmentFindMany.mockResolvedValue([{ client: { userId: 'u1' }, dog: { name: 'Bailey' } }])
    h.notifyClient.mockRejectedValue(new Error('resend down'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.runDelete).toHaveBeenCalledOnce()
  })

  it('surfaces a 500 with a message (not a silent ok) when the delete fails', async () => {
    h.transaction.mockRejectedValue(new Error('FK violation'))
    const res = await call()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Could not delete this class. Please try again.' })
  })

  it('404s an unknown run without deleting anything', async () => {
    h.runFindFirst.mockResolvedValue(null)
    const res = await call('nope')
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
  })
})
