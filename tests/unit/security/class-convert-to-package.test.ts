import { describe, it, expect, vi, beforeEach } from 'vitest'

// Converting a class back to a 1:1 package DELETES the run and its sessions —
// the package can't be 1:1 while a cohort hangs off it. That makes this
// destructive, so it must be scoped to the caller's business and refused the
// moment anyone is actually booked in.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  runFindFirst: vi.fn(),
  transaction: vi.fn(),
  sessionDeleteMany: vi.fn(),
  runDelete: vi.fn(),
  pkgUpdate: vi.fn(),
  deleteGoogleEvents: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/google-calendar-sync', () => ({ deleteGoogleEvents: h.deleteGoogleEvents }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classRun: { findFirst: h.runFindFirst, delete: h.runDelete },
    trainingSession: { deleteMany: h.sessionDeleteMany },
    package: { update: h.pkgUpdate },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/class-runs/[runId]/convert-to-package/route'

const call = () =>
  POST(new Request('http://localhost/api/class-runs/run_1/convert-to-package', { method: 'POST' }),
       { params: Promise.resolve({ runId: 'run_1' }) })

const RUN = {
  id: 'run_1', packageId: 'pkg_1',
  sessions: [{ googleCalendarEventId: 'gcal_1' }, { googleCalendarEventId: null }],
  enrollments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
  h.runFindFirst.mockResolvedValue(RUN)
  h.transaction.mockResolvedValue([])
  h.deleteGoogleEvents.mockResolvedValue(undefined)
})

describe('POST /api/class-runs/[runId]/convert-to-package', () => {
  it('scopes the run lookup to the caller’s business', async () => {
    await call()
    expect(h.runFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'run_1', trainerId: 'tr_me' })
  })

  it("404s on another business's class", async () => {
    h.runFindFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  // The important one: a class with people in it must not dissolve underneath
  // them — cancelling properly is what notifies them.
  it('refuses while anyone is booked in', async () => {
    h.runFindFirst.mockResolvedValue({ ...RUN, enrollments: [{ id: 'e1' }, { id: 'e2' }] })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/2 people are booked in/i)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('only counts non-withdrawn enrolments as "booked in"', async () => {
    await call()
    expect(h.runFindFirst.mock.calls[0][0].select.enrollments.where)
      .toEqual({ status: { not: 'WITHDRAWN' } })
  })

  it('returns the package id so the UI can land on it', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, packageId: 'pkg_1' })
  })

  it('pulls the mirrored Google events afterwards, skipping unsynced sessions', async () => {
    await call()
    expect(h.deleteGoogleEvents).toHaveBeenCalledWith('tr_me', ['gcal_1'], null)
  })

  it('rejects a caller with no business', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: null } })
    expect((await call()).status).toBe(401)
    expect(h.transaction).not.toHaveBeenCalled()
  })
})
