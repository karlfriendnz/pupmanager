import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant + permission guards on DELETE /api/class-runs/[runId].
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

const OWNER_CO = 'co1'
const OTHER_CO = 'co2'
const RUN = 'run1' // belongs to co1

function call(runId = RUN) {
  return DELETE(new Request('https://app.pupmanager.com/api/class-runs/' + runId, { method: 'DELETE' }), {
    params: Promise.resolve({ runId }),
  })
}

function expectNothingDeleted() {
  expect(h.transaction).not.toHaveBeenCalled()
  expect(h.sessionDeleteMany).not.toHaveBeenCalled()
  expect(h.runDelete).not.toHaveBeenCalled()
  expect(h.runUpdate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ trainerId: OWNER_CO, role: 'OWNER', permissions: [] })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: OWNER_CO } })
  // The route scopes the lookup by trainerId — a foreign tenant finds nothing.
  h.runFindFirst.mockImplementation(async ({ where }: { where: { id: string; trainerId: string } }) =>
    where.id === RUN && where.trainerId === OWNER_CO
      // sessions is selected by the route (mirrored Google event ids are
      // collected before the cascade removes them).
      ? { id: RUN, name: 'Spring Puppy Class', sessions: [] }
      : null,
  )
  h.enrollmentFindMany.mockResolvedValue([])
  h.sessionDeleteMany.mockResolvedValue({ count: 6 })
  h.runDelete.mockResolvedValue({ id: RUN })
  h.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
})

describe('DELETE /api/class-runs/[runId] — guards', () => {
  it("cross-tenant: another company's trainer cannot delete this class (404, nothing touched)", async () => {
    h.guardPermission.mockResolvedValue({ trainerId: OTHER_CO, role: 'OWNER', permissions: [] })
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: OTHER_CO } })

    const res = await call()
    expect(res.status).toBe(404)
    expect(h.runFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: RUN, trainerId: OTHER_CO } }))
    expectNothingDeleted()
  })

  it('rejects a caller without the classes.manage permission', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'You don’t have permission to do this.' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expectNothingDeleted()
  })

  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expectNothingDeleted()
  })

  it('rejects a client-role session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', trainerId: OWNER_CO } })
    const res = await call()
    expect(res.status).toBe(401)
    expectNothingDeleted()
  })

  it('rejects a trainer session with no company', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: null } })
    const res = await call()
    expect(res.status).toBe(401)
    expectNothingDeleted()
  })

  it('session deletion is tenant-scoped (never deletes another company’s sessions)', async () => {
    await call()
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { classRunId: RUN, trainerId: OWNER_CO } })
  })
})
