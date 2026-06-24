import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Security for the class-session attendance/notes route:
// PUT /api/class-runs/[runId]/sessions/[sessionId]/attendance
//   - guarded by classes.manage (read-only STAFF blocked → 403)
//   - non-trainer rejected (401)
//   - cross-tenant session (ownSession finds nothing) → 404, no mutation
//   - only enrolments belonging to the run are written (mass-assignment guard)

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  sessionFindFirst: vi.fn(),
  enrollmentFindMany: vi.fn(),
  attendanceUpsert: vi.fn(),
  sessionUpdate: vi.fn(),
  $transaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst, update: h.sessionUpdate },
    classEnrollment: { findMany: h.enrollmentFindMany },
    sessionAttendance: { upsert: h.attendanceUpsert },
    $transaction: h.$transaction,
  },
}))

import { PUT } from '@/app/api/class-runs/[runId]/sessions/[sessionId]/attendance/route'

function params(runId: string, sessionId: string) {
  return { params: Promise.resolve({ runId, sessionId }) }
}
function req(body: unknown) {
  return new Request('https://app.pupmanager.com/api/x', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  // Default: permission held, session owned, transaction passes through.
  h.guardPermission.mockResolvedValue({ companyId: 't1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 't1' } })
  h.sessionFindFirst.mockResolvedValue({ id: 's1' })
  h.enrollmentFindMany.mockResolvedValue([{ id: 'enr1' }])
  h.attendanceUpsert.mockReturnValue({})
  h.sessionUpdate.mockResolvedValue({})
  h.$transaction.mockResolvedValue([])
})

const goodBody = { records: [{ enrollmentId: 'enr1', status: 'PRESENT', note: 'good boy' }] }

describe('PUT attendance — authz + tenant scoping', () => {
  it('403 when a read-only STAFF member lacks classes.manage', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await PUT(req(goodBody), params('run1', 's1'))
    expect(res.status).toBe(403)
    expect(h.$transaction).not.toHaveBeenCalled()
  })

  it('401 when the session is not a TRAINER role', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await PUT(req(goodBody), params('run1', 's1'))
    expect(res.status).toBe(401)
    expect(h.$transaction).not.toHaveBeenCalled()
  })

  it('404 (no mutation) for a cross-tenant / foreign session id', async () => {
    // ownSession scoped to classRun.trainerId finds nothing → foreign session.
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await PUT(req(goodBody), params('run1', 'FOREIGN-session'))
    expect(res.status).toBe(404)
    expect(h.$transaction).not.toHaveBeenCalled()
    expect(h.attendanceUpsert).not.toHaveBeenCalled()
  })

  it('400 on an invalid body', async () => {
    const res = await PUT(req({ records: 'nope' }), params('run1', 's1'))
    expect(res.status).toBe(400)
    expect(h.$transaction).not.toHaveBeenCalled()
  })

  it('writes only enrolments that belong to the run (mass-assignment guard)', async () => {
    // Two records sent; only enr-own actually belongs to the run.
    h.enrollmentFindMany.mockResolvedValue([{ id: 'enr-own' }])
    h.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops))
    const body = { records: [
      { enrollmentId: 'enr-own', status: 'PRESENT' },
      { enrollmentId: 'enr-foreign', status: 'PRESENT' },
    ] }
    const res = await PUT(req(body), params('run1', 's1'))
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.saved).toBe(1) // foreign enrolment filtered out
    expect(h.attendanceUpsert).toHaveBeenCalledTimes(1)
    expect(h.attendanceUpsert.mock.calls[0][0].where.sessionId_enrollmentId.enrollmentId).toBe('enr-own')
  })

  it('happy path: 200 and persists owned records', async () => {
    h.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops))
    const res = await PUT(req(goodBody), params('run1', 's1'))
    expect(res.status).toBe(200)
    expect(h.attendanceUpsert).toHaveBeenCalledTimes(1)
  })
})
