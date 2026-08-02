import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Deleting an offering that has been SCHEDULED.
//
// ClassRun.package is `onDelete: Restrict`, and DELETE /api/packages/[packageId]
// used to call prisma.package.delete with no pre-check and no catch — Postgres
// refused, the route 500'd, and the form printed "Could not delete this
// offering." A daycare hit it every time (its run is created in the same
// transaction as the programme). These lock in the fix: an empty run is cleared
// out of the way, anything with people or money on it refuses with a reason, and
// the trainer lands back on the list the offering was actually on.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  auth: vi.fn(),
  pkgFindFirst: vi.fn(),
  runFindMany: vi.fn(),
  enrollmentCount: vi.fn(),
  attendanceCount: vi.fn(),
  clientPackageFindMany: vi.fn(),
  invoiceCount: vi.fn(),
  paymentItemCount: vi.fn(),
  sessionDeleteMany: vi.fn(),
  runDeleteMany: vi.fn(),
  pkgDelete: vi.fn(),
  removeClassEvents: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/class-session-sync', () => ({
  syncClassSessions: vi.fn(async () => {}),
  removeClassEvents: h.removeClassEvents,
}))

const tx = {
  trainingSession: { deleteMany: h.sessionDeleteMany },
  classRun: { deleteMany: h.runDeleteMany },
  package: { delete: h.pkgDelete },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst, delete: h.pkgDelete },
    classRun: { findMany: h.runFindMany, count: vi.fn(async () => 0), deleteMany: h.runDeleteMany },
    classEnrollment: { count: h.enrollmentCount },
    sessionAttendance: { count: h.attendanceCount },
    clientPackage: { findMany: h.clientPackageFindMany, count: vi.fn(async () => 0) },
    invoice: { count: h.invoiceCount },
    paymentItem: { count: h.paymentItemCount },
    trainingSession: { deleteMany: h.sessionDeleteMany },
    $transaction: vi.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
  },
}))

import { DELETE } from '@/app/api/packages/[packageId]/route'

const params = { params: Promise.resolve({ packageId: 'pkg1' }) }
const req = () => new Request('https://app.pupmanager.com/api/packages/pkg1', { method: 'DELETE' })

/** A daycare programme: group, drop-in, isPuppySchool. */
const daycare = {
  id: 'pkg1', trainerId: 't1', name: 'Waggy Tails',
  isGroup: true, isEvent: false, allowDropIn: true, isPuppySchool: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: 't1' } })
  h.pkgFindFirst.mockResolvedValue(daycare)
  h.runFindMany.mockResolvedValue([])
  h.enrollmentCount.mockResolvedValue(0)
  h.attendanceCount.mockResolvedValue(0)
  h.clientPackageFindMany.mockResolvedValue([])
  h.invoiceCount.mockResolvedValue(0)
  h.paymentItemCount.mockResolvedValue(0)
})

describe('DELETE /api/packages/[packageId] — guards', () => {
  it('refuses a caller without packages.manage before reading anything', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await DELETE(req(), params)
    expect(res.status).toBe(403)
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })

  it('404s an offering another company owns', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(404)
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/packages/[packageId] — a scheduled offering', () => {
  it('deletes the empty run WITH the package, in one transaction', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'run1', sessions: [] }])
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    // The run has to go first — it is the Restrict FK that was blocking it.
    expect(h.runDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['run1'] }, trainerId: 't1' } })
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { classRunId: { in: ['run1'] }, trainerId: 't1' } })
    expect(h.pkgDelete).toHaveBeenCalledWith({ where: { id: 'pkg1' } })
  })

  it('sends a daycare back to /doggy-daycare, not the 1:1 Sessions list', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'run1', sessions: [] }])
    const res = await DELETE(req(), params)
    expect(await res.json()).toMatchObject({ ok: true, redirectTo: '/doggy-daycare' })
  })

  it('sends a 1:1 offering back to /packages', async () => {
    h.pkgFindFirst.mockResolvedValue({ ...daycare, isGroup: false, allowDropIn: false, isPuppySchool: false })
    const res = await DELETE(req(), params)
    expect(await res.json()).toMatchObject({ redirectTo: '/packages' })
  })

  it('pulls the run’s mirrored Google events after the delete', async () => {
    h.runFindMany.mockResolvedValue([
      { id: 'run1', sessions: [{ googleCalendarEventId: 'evt1' }, { googleCalendarEventId: null }] },
    ])
    await DELETE(req(), params)
    expect(h.removeClassEvents).toHaveBeenCalledWith('t1', ['evt1'])
  })
})

describe('DELETE /api/packages/[packageId] — refuses rather than destroying', () => {
  it('refuses when people are booked in, naming how many', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'run1', sessions: [] }])
    h.enrollmentCount.mockResolvedValue(3)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('3 bookings on this daycare programme')
    expect(h.runDeleteMany).not.toHaveBeenCalled()
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })

  it('refuses when attendance has been recorded', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'run1', sessions: [] }])
    h.attendanceCount.mockResolvedValue(1)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('attendance recorded')
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })

  it('refuses a 1:1 offering whose assignments have been invoiced', async () => {
    h.pkgFindFirst.mockResolvedValue({ ...daycare, isGroup: false, allowDropIn: false, isPuppySchool: false })
    h.clientPackageFindMany.mockResolvedValue([{ id: 'cp1' }])
    h.invoiceCount.mockResolvedValue(1)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('billed for')
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })

  it('refuses a 1:1 offering whose assignments have been paid for', async () => {
    h.pkgFindFirst.mockResolvedValue({ ...daycare, isGroup: false, allowDropIn: false, isPuppySchool: false })
    h.clientPackageFindMany.mockResolvedValue([{ id: 'cp1' }])
    h.paymentItemCount.mockResolvedValue(1)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(409)
    expect(h.pkgDelete).not.toHaveBeenCalled()
  })

  it('lets an un-billed 1:1 offering through', async () => {
    h.pkgFindFirst.mockResolvedValue({ ...daycare, isGroup: false, allowDropIn: false, isPuppySchool: false })
    h.clientPackageFindMany.mockResolvedValue([{ id: 'cp1' }])
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(h.pkgDelete).toHaveBeenCalled()
  })

  it('answers a DB refusal with a message, never a bare 500 throw', async () => {
    h.runFindMany.mockResolvedValue([{ id: 'run1', sessions: [] }])
    h.pkgDelete.mockRejectedValue(new Error('FK violation'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await DELETE(req(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Could not delete this offering')
    spy.mockRestore()
  })
})
