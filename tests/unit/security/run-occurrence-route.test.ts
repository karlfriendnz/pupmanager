import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on "cancel or move ONE week of a class".
//
// Two ids come in from the request — a run and a session — and one is not
// enough: a session that belongs to a DIFFERENT class of the same trainer must
// not be movable through this run's URL, and neither id may reach across
// companies. The permission is classes.manage, because moving a class everybody
// turns up to is precisely what a read-only team member must not do.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  auth: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdate: vi.fn(),
  enrollFindMany: vi.fn(),
  notifyClient: vi.fn(),
  syncGoogle: vi.fn(),
  deleteGoogle: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/google-calendar-sync', () => ({
  syncSessionToGoogle: h.syncGoogle,
  deleteGoogleEvents: h.deleteGoogle,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst, update: h.sessionUpdate },
    classEnrollment: { findMany: h.enrollFindMany },
  },
}))

import { PATCH } from '@/app/api/class-runs/[runId]/sessions/[sessionId]/route'

const params = (runId = 'r1', sessionId = 's1') => ({ params: Promise.resolve({ runId, sessionId }) })
const patch = (b: unknown) =>
  new Request('https://app.pupmanager.com/x', { method: 'PATCH', body: JSON.stringify(b) })

const SESSION = {
  id: 's1',
  scheduledAt: new Date('2026-10-27T05:00:00.000Z'),
  durationMins: 60,
  location: 'The hall',
  title: 'Tuesday drop-in — session 4/8',
  cancelledAt: null as Date | null,
  scheduleOverriddenAt: null as Date | null,
  originalScheduledAt: null as Date | null,
  googleCalendarEventId: null as string | null,
  assignedMembershipId: null as string | null,
  classRun: { id: 'r1', name: 'Tuesday drop-in', trainer: { user: { timezone: 'Pacific/Auckland' } } },
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guard.mockResolvedValue({ companyId: 'co1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 'co1' } })
  h.sessionFindFirst.mockResolvedValue(SESSION)
  h.sessionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 's1', scheduledAt: SESSION.scheduledAt, durationMins: 60, bufferMins: 0, location: null,
    cancelledAt: null, cancelReason: null, scheduleOverriddenAt: null, originalScheduledAt: null,
    ...data,
  }))
  h.enrollFindMany.mockResolvedValue([])
})

describe('permission + tenant', () => {
  it('hands a permission refusal straight back without touching the data', async () => {
    const { NextResponse } = await import('next/server')
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await PATCH(patch({ cancelled: true }), params())
    expect(res.status).toBe(403)
    expect(h.sessionFindFirst).not.toHaveBeenCalled()
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('asks for classes.manage, not merely "is a trainer"', async () => {
    await PATCH(patch({ cancelled: true }), params())
    expect(h.guard).toHaveBeenCalledWith('classes.manage')
  })

  it('scopes the lookup by BOTH ids and by the run\'s owning company', async () => {
    await PATCH(patch({ cancelled: true }), params('r1', 's1'))
    expect(h.sessionFindFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      classRunId: 'r1',
      classRun: { trainerId: 'co1' },
    })
  })

  it('404s — and writes nothing — for a session that is not on this run', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await PATCH(patch({ scheduledAt: '2026-11-03T05:00:00.000Z' }), params('r1', 's-elsewhere'))
    expect(res.status).toBe(404)
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('refuses a payload that asks for nothing', async () => {
    const res = await PATCH(patch({}), params())
    expect(res.status).toBe(400)
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })
})

describe('cancelling one week', () => {
  it('sets the tombstone and the reason, and never deletes the row', async () => {
    await PATCH(patch({ cancelled: true, reason: 'Labour Day' }), params())
    const data = h.sessionUpdate.mock.calls[0][0].data
    expect(data.cancelledAt).toBeInstanceOf(Date)
    expect(data.cancelReason).toBe('Labour Day')
    // The whole design: the register and every drop-in booking cascade off this
    // row, so it stays.
    expect(h.sessionUpdate.mock.calls[0][0].where).toEqual({ id: 's1' })
  })

  it('tells the people it affects — the course, plus THIS week\'s drop-ins only', async () => {
    h.enrollFindMany.mockResolvedValue([
      { client: { userId: 'u-a' }, dog: { name: 'Bo' } },
      { client: { userId: 'u-b' }, dog: null },
    ])
    await PATCH(patch({ cancelled: true, reason: 'Labour Day' }), params())
    // Cancelling week 4 is no business of someone who only booked week 9.
    expect(h.enrollFindMany.mock.calls[0][0].where).toMatchObject({
      classRunId: 'r1',
      status: 'ENROLLED',
      OR: [{ type: 'FULL' }, { type: 'DROP_IN', dropInSessionId: 's1' }],
    })
    expect(h.notifyClient).toHaveBeenCalledTimes(2)
    expect(h.notifyClient.mock.calls[0][0]).toMatchObject({ type: 'CLIENT_SESSION_CHANGED', trainerId: 'co1' })
  })

  it('takes it off the calendar and clears the mirrored id', async () => {
    // Leaving the id behind would have the next sync patch an event that no
    // longer exists.
    h.sessionFindFirst.mockResolvedValue({ ...SESSION, googleCalendarEventId: 'gcal-1' })
    await PATCH(patch({ cancelled: true }), params())
    expect(h.deleteGoogle).toHaveBeenCalledWith('co1', ['gcal-1'], null)
    expect(h.sessionUpdate.mock.calls[1][0].data).toEqual({ googleCalendarEventId: null })
  })

  it('puts it back on, and says so', async () => {
    h.sessionFindFirst.mockResolvedValue({ ...SESSION, cancelledAt: new Date('2026-08-01T00:00:00.000Z') })
    h.enrollFindMany.mockResolvedValue([{ client: { userId: 'u-a' }, dog: { name: 'Bo' } }])
    await PATCH(patch({ cancelled: false }), params())
    expect(h.sessionUpdate.mock.calls[0][0].data).toMatchObject({ cancelledAt: null, cancelReason: null })
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
  })
})

describe('moving one week', () => {
  it('marks it hand-set and records where the generator had put it', async () => {
    await PATCH(patch({ scheduledAt: '2026-10-27T06:00:00.000Z' }), params())
    const data = h.sessionUpdate.mock.calls[0][0].data
    expect(data.scheduledAt).toEqual(new Date('2026-10-27T06:00:00.000Z'))
    expect(data.scheduleOverriddenAt).toBeInstanceOf(Date)
    // The instant the nightly top-up checks before creating the week again.
    expect(data.originalScheduledAt).toEqual(SESSION.scheduledAt)
    // And the client is told, through the batched reschedule banner.
    expect(data.rescheduleNotifyPendingAt).toBeInstanceOf(Date)
  })

  it('never loses the ORIGINAL time on a second move', async () => {
    // Overwriting it with the first move's destination would let the planner
    // re-create the week at a time the trainer had already abandoned.
    const first = new Date('2026-10-27T05:00:00.000Z')
    h.sessionFindFirst.mockResolvedValue({
      ...SESSION,
      scheduledAt: new Date('2026-10-27T06:00:00.000Z'),
      scheduleOverriddenAt: new Date('2026-08-01T00:00:00.000Z'),
      originalScheduledAt: first,
    })
    await PATCH(patch({ scheduledAt: '2026-10-27T07:00:00.000Z' }), params())
    const data = h.sessionUpdate.mock.calls[0][0].data
    expect(data.originalScheduledAt).toBeUndefined()
    expect(data.scheduleOverriddenAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })

  it('marks a venue-only change hand-set too, so a later venue save can\'t undo it', async () => {
    await PATCH(patch({ location: 'The scout hall' }), params())
    const data = h.sessionUpdate.mock.calls[0][0].data
    expect(data.location).toBe('The scout hall')
    expect(data.scheduleOverriddenAt).toBeInstanceOf(Date)
    // Nothing moved, so nobody is told a time changed.
    expect(data.rescheduleNotifyPendingAt).toBeUndefined()
  })

  it('refuses a duration outside the sane range', async () => {
    const res = await PATCH(patch({ durationMins: 9999 }), params())
    expect(res.status).toBe(400)
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })
})
