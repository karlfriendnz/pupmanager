import { it, expect, vi, beforeEach, describe } from 'vitest'

// google-calendar-sync — per-STAFF-MEMBER, best-effort mirror of PupManager
// entities into each member's Google Calendar, plus busy-import. Contract:
//   - a session routes to its assignedMembershipId's connection; when unassigned
//     (or that member hasn't connected) it falls back to the company OWNER's
//   - event bodies are built correctly
//   - no-op when the add-on is off OR nobody relevant is connected
//   - a Google failure is swallowed (never throws)
//   - busy refresh no-ops when the member isn't connected
const h = vi.hoisted(() => ({
  hasAddon: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  gcalFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  busyDeleteMany: vi.fn(),
  busyCreateMany: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  fetchFreeBusy: vi.fn(),
  fetchCalendarEvents: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findUnique: h.sessionFindUnique, update: h.sessionUpdate, findMany: vi.fn() },
    availabilitySlot: { findUnique: vi.fn(), update: vi.fn() },
    blackoutPeriod: { findUnique: vi.fn(), update: vi.fn() },
    googleCalendarConnection: { findUnique: h.gcalFindUnique, findMany: vi.fn() },
    trainerMembership: { findFirst: h.membershipFindFirst, findUnique: h.membershipFindUnique },
    googleBusyBlock: { deleteMany: h.busyDeleteMany, createMany: h.busyCreateMany },
  },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({
  upsertCalendarEvent: h.upsertCalendarEvent,
  deleteCalendarEvent: h.deleteCalendarEvent,
  fetchFreeBusy: h.fetchFreeBusy,
  fetchCalendarEvents: h.fetchCalendarEvents,
}))

import {
  buildSessionEvent,
  buildAvailabilitySlotEvent,
  buildBlackoutEvent,
  busyOverlaps,
  overlapsAnyBusy,
  syncSessionToGoogle,
  deleteGoogleEvents,
  refreshBusyForMembership,
} from '@/lib/google-calendar-sync'

// Two connections: one for an assigned member, one for the company owner.
const assignedConn = { id: 'gc-a', membershipId: 'mem-assigned', companyId: 'co-1', calendarId: 'primary', refreshToken: 'r' }
const ownerConn = { id: 'gc-o', membershipId: 'mem-owner', companyId: 'co-1', calendarId: 'primary', refreshToken: 'r' }
let connections: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  h.hasAddon.mockResolvedValue(true)
  h.sessionUpdate.mockResolvedValue({})
  h.membershipFindFirst.mockResolvedValue({ id: 'mem-owner' }) // owner lookup
  connections = { 'mem-assigned': assignedConn, 'mem-owner': ownerConn }
  h.gcalFindUnique.mockImplementation(({ where }: { where: { membershipId: string } }) =>
    Promise.resolve(connections[where.membershipId] ?? null),
  )
})

function seedSession(over: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    trainerId: 'co-1', // == companyId
    assignedMembershipId: 'mem-assigned',
    title: 'Puppy 1:1',
    description: 'Loose-lead',
    location: 'Park',
    scheduledAt: new Date('2026-07-06T02:00:00.000Z'),
    durationMins: 45,
    googleCalendarEventId: null,
    ...over,
  }
}

describe('event builders', () => {
  it('builds a session event with a start + end offset by durationMins', () => {
    const ev = buildSessionEvent(seedSession() as never)
    expect(ev.summary).toBe('Puppy 1:1')
    expect(ev.start).toEqual({ dateTime: '2026-07-06T02:00:00.000Z' })
    expect(ev.end).toEqual({ dateTime: '2026-07-06T02:45:00.000Z' })
  })

  it('builds a recurring weekly availability event with an RRULE', () => {
    const slot = {
      title: 'Morning walks', dayOfWeek: 1, date: null, startTime: '09:00', endTime: '11:00',
      cadenceWeeks: 2, firstDate: new Date('2026-07-06T00:00:00.000Z'),
    }
    const ev = buildAvailabilitySlotEvent(slot as never, 'Pacific/Auckland')!
    expect(ev.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'])
    expect(ev.start).toEqual({ dateTime: '2026-07-06T09:00:00', timeZone: 'Pacific/Auckland' })
  })

  it('builds a one-off availability event (no recurrence) and defaults the title', () => {
    const slot = { title: null, dayOfWeek: null, date: new Date('2026-07-10T00:00:00.000Z'), startTime: '14:00', endTime: '15:30', cadenceWeeks: 1, firstDate: null }
    const ev = buildAvailabilitySlotEvent(slot as never, 'UTC')!
    expect(ev.summary).toBe('Available')
    expect(ev.recurrence).toBeUndefined()
  })

  it('builds an all-day blackout event with an exclusive end date', () => {
    const ev = buildBlackoutEvent({ reason: 'Holiday', startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-03T00:00:00.000Z') } as never)
    expect(ev.start).toEqual({ date: '2026-08-01' })
    expect(ev.end).toEqual({ date: '2026-08-04' })
  })
})

describe('overlap detection', () => {
  const t = (s: string) => new Date(s)
  it('detects overlapping half-open intervals', () => {
    expect(busyOverlaps(t('2026-07-06T09:00Z'), t('2026-07-06T10:00Z'), t('2026-07-06T09:30Z'), t('2026-07-06T10:30Z'))).toBe(true)
  })
  it('treats touching edges as non-overlapping', () => {
    expect(busyOverlaps(t('2026-07-06T09:00Z'), t('2026-07-06T10:00Z'), t('2026-07-06T10:00Z'), t('2026-07-06T11:00Z'))).toBe(false)
  })
  it('overlapsAnyBusy finds a clash among blocks', () => {
    const blocks = [
      { startsAt: t('2026-07-06T08:00Z'), endsAt: t('2026-07-06T08:30Z') },
      { startsAt: t('2026-07-06T09:45Z'), endsAt: t('2026-07-06T10:15Z') },
    ]
    expect(overlapsAnyBusy(blocks, t('2026-07-06T09:00Z'), t('2026-07-06T10:00Z'))).toBe(true)
    expect(overlapsAnyBusy(blocks, t('2026-07-06T11:00Z'), t('2026-07-06T12:00Z'))).toBe(false)
  })
})

describe('syncSessionToGoogle — membership routing', () => {
  it('routes to the assigned member’s connection when assigned + connected', async () => {
    h.sessionFindUnique.mockResolvedValue(seedSession())
    h.upsertCalendarEvent.mockResolvedValue('evt-1')

    await syncSessionToGoogle('sess-1')

    expect(h.upsertCalendarEvent).toHaveBeenCalledWith(assignedConn, null, expect.objectContaining({ summary: 'Puppy 1:1' }))
    expect(h.membershipFindFirst).not.toHaveBeenCalled() // no owner fallback needed
    expect(h.sessionUpdate).toHaveBeenCalledWith({ where: { id: 'sess-1' }, data: { googleCalendarEventId: 'evt-1' } })
  })

  it('falls back to the company owner’s connection when the session is unassigned', async () => {
    h.sessionFindUnique.mockResolvedValue(seedSession({ assignedMembershipId: null }))
    h.upsertCalendarEvent.mockResolvedValue('evt-2')

    await syncSessionToGoogle('sess-1')

    expect(h.membershipFindFirst).toHaveBeenCalledWith({ where: { companyId: 'co-1', role: 'OWNER' }, select: { id: true } })
    expect(h.upsertCalendarEvent).toHaveBeenCalledWith(ownerConn, null, expect.anything())
  })

  it('falls back to the owner when the assigned member has not connected', async () => {
    h.sessionFindUnique.mockResolvedValue(seedSession({ assignedMembershipId: 'mem-nope' }))
    h.upsertCalendarEvent.mockResolvedValue('evt-3')

    await syncSessionToGoogle('sess-1')

    expect(h.upsertCalendarEvent).toHaveBeenCalledWith(ownerConn, null, expect.anything())
  })

  it('no-ops when the add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)
    h.sessionFindUnique.mockResolvedValue(seedSession())
    await syncSessionToGoogle('sess-1')
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('no-ops when nobody relevant is connected', async () => {
    connections = {} // neither assigned nor owner connected
    h.sessionFindUnique.mockResolvedValue(seedSession({ assignedMembershipId: null }))
    await syncSessionToGoogle('sess-1')
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
  })

  it('swallows a Google failure — never throws, never persists', async () => {
    h.sessionFindUnique.mockResolvedValue(seedSession())
    h.upsertCalendarEvent.mockRejectedValue(new Error('Google 500'))
    await expect(syncSessionToGoogle('sess-1')).resolves.toBeUndefined()
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })
})

describe('deleteGoogleEvents', () => {
  it('filters out null ids and no-ops when nothing remains', async () => {
    await deleteGoogleEvents('co-1', [null, undefined])
    expect(h.hasAddon).not.toHaveBeenCalled()
    expect(h.deleteCalendarEvent).not.toHaveBeenCalled()
  })

  it('deletes each real event id via the assigned member’s connection', async () => {
    h.deleteCalendarEvent.mockResolvedValue(undefined)
    await deleteGoogleEvents('co-1', ['evt-a', null, 'evt-b'], 'mem-assigned')
    expect(h.deleteCalendarEvent).toHaveBeenCalledTimes(2)
    expect(h.deleteCalendarEvent).toHaveBeenCalledWith(assignedConn, 'evt-a')
    expect(h.deleteCalendarEvent).toHaveBeenCalledWith(assignedConn, 'evt-b')
  })
})

describe('refreshBusyForMembership', () => {
  it('no-ops (returns 0) when the member is not connected', async () => {
    connections = {} // gcalFindUnique returns null
    const n = await refreshBusyForMembership('mem-assigned')
    expect(n).toBe(0)
    expect(h.fetchCalendarEvents).not.toHaveBeenCalled()
    expect(h.busyDeleteMany).not.toHaveBeenCalled()
  })

  it('no-ops when the add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)
    const n = await refreshBusyForMembership('mem-assigned')
    expect(n).toBe(0)
    expect(h.fetchCalendarEvents).not.toHaveBeenCalled()
  })

  it('replaces the member’s busy blocks with the fetched window', async () => {
    h.busyDeleteMany.mockResolvedValue({})
    h.busyCreateMany.mockResolvedValue({})
    h.fetchCalendarEvents.mockResolvedValue([
      { start: new Date('2026-07-06T09:00:00Z'), end: new Date('2026-07-06T10:00:00Z'), title: 'Dentist' },
    ])

    const n = await refreshBusyForMembership('mem-assigned')

    expect(n).toBe(1)
    expect(h.busyDeleteMany).toHaveBeenCalledWith({ where: { membershipId: 'mem-assigned' } })
    expect(h.busyCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ membershipId: 'mem-assigned', companyId: 'co-1', title: 'Dentist' })],
    })
  })

  it('swallows a calendar-events failure (returns 0, clears nothing new)', async () => {
    h.busyDeleteMany.mockResolvedValue({})
    h.fetchCalendarEvents.mockRejectedValue(new Error('Google 500'))
    const n = await refreshBusyForMembership('mem-assigned')
    expect(n).toBe(0)
    expect(h.busyCreateMany).not.toHaveBeenCalled()
  })
})
