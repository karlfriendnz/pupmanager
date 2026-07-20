import { describe, it, expect, vi, beforeEach } from 'vitest'

// The group-class routes must mirror their sessions to Google Calendar:
//   • POST /api/class-runs        → sync the newly-created session series
//   • PATCH /api/class-runs/[runId] on a reschedule → delete the OLD mirrored
//     events, then sync the rebuilt series
// Both are best-effort and must never break the write.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  createClassRun: vi.fn(),
  createClassWithPackage: vi.fn(),
  updateClass: vi.fn(),
  notifyClient: vi.fn(),
  syncSessionsToGoogle: vi.fn(),
  deleteGoogleEvents: vi.fn(),
  // prisma surface used by the PATCH notify path
  classRunFindFirst: vi.fn(),
  classRunFindUnique: vi.fn(),
  classRunUpdate: vi.fn(),
  classRunDelete: vi.fn(),
  sessionDeleteMany: vi.fn(),
  txn: vi.fn(),
  enrollmentFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/class-runs', () => {
  class ClassError extends Error { code: string; constructor(code: string, m: string) { super(m); this.code = code } }
  return {
    createClassRun: h.createClassRun,
    createClassWithPackage: h.createClassWithPackage,
    updateClass: h.updateClass,
    ClassError,
  }
})
vi.mock('@/lib/google-calendar-sync', () => ({
  syncSessionsToGoogle: h.syncSessionsToGoogle,
  deleteGoogleEvents: h.deleteGoogleEvents,
}))
vi.mock('@/lib/buffer', () => ({ MAX_BUFFER_MINS: 240 }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classRun: { findFirst: h.classRunFindFirst, findUnique: h.classRunFindUnique, update: h.classRunUpdate, delete: h.classRunDelete },
    trainingSession: { deleteMany: h.sessionDeleteMany },
    classEnrollment: { findMany: h.enrollmentFindMany },
    $transaction: h.txn,
  },
}))

import { POST } from '@/app/api/class-runs/route'
import { PATCH, DELETE } from '@/app/api/class-runs/[runId]/route'

const TRAINER = 'co1'

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ trainerId: TRAINER, role: 'OWNER', permissions: [] })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER } })
  h.syncSessionsToGoogle.mockResolvedValue(undefined)
  h.deleteGoogleEvents.mockResolvedValue(undefined)
  h.notifyClient.mockResolvedValue(undefined)
  h.enrollmentFindMany.mockResolvedValue([])
  h.txn.mockResolvedValue([])
})

describe('POST /api/class-runs — mirrors the new class series to Google', () => {
  it('syncs exactly the created session ids (one-step create)', async () => {
    h.createClassWithPackage.mockResolvedValue({ id: 'run-1', sessionCount: 2, createdSessionIds: ['s1', 's2'] })
    const req = new Request('https://app.pupmanager.com/api/class-runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Puppy Class', startDate: '2026-08-01T09:00:00.000Z', sessionCount: 2, durationMins: 60, sessionType: 'IN_PERSON' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    // Internal ids must not leak into the API response.
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'run-1', sessionCount: 2 })
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['s1', 's2'])
  })

  it('legacy package-run path also syncs its created ids', async () => {
    h.createClassRun.mockResolvedValue({ id: 'run-2', sessionCount: 1, createdSessionIds: ['s9'] })
    const req = new Request('https://app.pupmanager.com/api/class-runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'From Package', startDate: '2026-08-01T09:00:00.000Z', packageId: 'pkg-1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['s9'])
  })

  it('a Google failure never breaks the create (still 201)', async () => {
    h.createClassWithPackage.mockResolvedValue({ id: 'run-3', sessionCount: 1, createdSessionIds: ['s1'] })
    h.syncSessionsToGoogle.mockRejectedValue(new Error('Google 500'))
    const req = new Request('https://app.pupmanager.com/api/class-runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Puppy', startDate: '2026-08-01T09:00:00.000Z', sessionCount: 1, durationMins: 60, sessionType: 'IN_PERSON' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })
})

describe('PATCH /api/class-runs/[runId] — reschedule keeps Google in step', () => {
  function patchReq(body: Record<string, unknown>) {
    return PATCH(
      new Request('https://app.pupmanager.com/api/class-runs/run-1', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    )
  }
  const fullEdit = {
    name: 'Puppy', startDate: '2026-09-01T09:00:00.000Z', sessionCount: 4, durationMins: 60, sessionType: 'IN_PERSON',
  }

  beforeEach(() => {
    h.classRunFindFirst.mockResolvedValue({ id: 'run-1', trainerId: TRAINER }) // ownRun
    h.classRunFindUnique.mockResolvedValue({ name: 'Puppy', trainer: { user: { timezone: 'Pacific/Auckland' } }, sessions: [] })
  })

  it('removes the old events then syncs the rebuilt ids', async () => {
    h.updateClass.mockResolvedValue({ scheduleChanged: true, createdSessionIds: ['n1', 'n2'], deletedEventIds: ['e1', 'e2'] })
    const res = await patchReq(fullEdit)
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).toHaveBeenCalledWith(TRAINER, ['e1', 'e2'])
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['n1', 'n2'])
  })

  it('a settings-only edit (no reschedule) touches Google not at all', async () => {
    h.updateClass.mockResolvedValue({ scheduleChanged: false, createdSessionIds: [], deletedEventIds: [] })
    const res = await patchReq(fullEdit)
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).not.toHaveBeenCalled()
    expect(h.syncSessionsToGoogle).not.toHaveBeenCalled()
  })

  it('skips the delete when the rebuilt class had no mirrored events', async () => {
    h.updateClass.mockResolvedValue({ scheduleChanged: true, createdSessionIds: ['n1'], deletedEventIds: [] })
    const res = await patchReq(fullEdit)
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).not.toHaveBeenCalled()
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['n1'])
  })
})

describe('DELETE /api/class-runs/[runId] — removes the class events from Google', () => {
  function delReq() {
    return DELETE(
      new Request('https://app.pupmanager.com/api/class-runs/run-1', { method: 'DELETE' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    )
  }

  it('deletes exactly the mirrored event ids of the class sessions', async () => {
    h.classRunFindFirst.mockResolvedValue({
      id: 'run-1', name: 'Puppy',
      sessions: [{ googleCalendarEventId: 'e1' }, { googleCalendarEventId: null }, { googleCalendarEventId: 'e2' }],
    })
    const res = await delReq()
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).toHaveBeenCalledWith(TRAINER, ['e1', 'e2'])
  })

  it('touches Google not at all when no session was ever mirrored', async () => {
    h.classRunFindFirst.mockResolvedValue({
      id: 'run-1', name: 'Puppy', sessions: [{ googleCalendarEventId: null }],
    })
    const res = await delReq()
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).not.toHaveBeenCalled()
  })

  it('a Google failure never breaks the delete', async () => {
    h.classRunFindFirst.mockResolvedValue({ id: 'run-1', name: 'Puppy', sessions: [{ googleCalendarEventId: 'e1' }] })
    h.deleteGoogleEvents.mockRejectedValue(new Error('Google 500'))
    const res = await delReq()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: true })
  })
})
