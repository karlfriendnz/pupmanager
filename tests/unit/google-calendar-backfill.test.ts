import { it, expect, vi, beforeEach, describe } from 'vitest'

// backfillSessionsToGoogle — one-off, idempotent, resumable push of
// pre-existing future-dated sessions into connected calendars. Contract:
//   - only companies that are connected AND have the add-on on are in scope
//   - count mode writes nothing
//   - execute mode mirrors the un-mirrored sessions and reports synced/remaining
const h = vi.hoisted(() => ({
  hasAddon: vi.fn(),
  connFindMany: vi.fn(),
  sessionCount: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  gcalFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  upsertCalendarEvent: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: {
      count: h.sessionCount,
      findMany: h.sessionFindMany,
      findUnique: h.sessionFindUnique,
      update: h.sessionUpdate,
    },
    googleCalendarConnection: { findMany: h.connFindMany, findUnique: h.gcalFindUnique },
    trainerMembership: { findFirst: h.membershipFindFirst, findUnique: h.membershipFindUnique },
  },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({
  upsertCalendarEvent: h.upsertCalendarEvent,
  deleteCalendarEvent: vi.fn(),
  fetchFreeBusy: vi.fn(),
  fetchCalendarEvents: vi.fn(),
}))

import { backfillSessionsToGoogle } from '@/lib/google-calendar-sync'

const ownerConn = { id: 'gc-o', membershipId: 'mem-owner', companyId: 'co-1', calendarId: 'primary', refreshToken: 'r' }

beforeEach(() => {
  vi.clearAllMocks()
  h.hasAddon.mockResolvedValue(true)
  h.connFindMany.mockResolvedValue([{ companyId: 'co-1' }])
  h.membershipFindFirst.mockResolvedValue({ id: 'mem-owner' })
  h.gcalFindUnique.mockResolvedValue(ownerConn)
  h.membershipFindUnique.mockResolvedValue({ user: { timezone: 'UTC' } })
})

describe('backfillSessionsToGoogle', () => {
  it('count mode reports candidates and writes nothing', async () => {
    h.sessionCount.mockResolvedValueOnce(4) // candidates
    const res = await backfillSessionsToGoogle({ execute: false })
    expect(res).toEqual({ activeCompanies: 1, candidates: 4, synced: 0, remaining: 4 })
    expect(h.sessionFindMany).not.toHaveBeenCalled()
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
  })

  it('skips companies whose add-on is off (nothing in scope)', async () => {
    h.hasAddon.mockResolvedValue(false)
    const res = await backfillSessionsToGoogle({ execute: true })
    expect(res).toEqual({ activeCompanies: 0, candidates: 0, synced: 0, remaining: 0 })
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
  })

  it('execute mode mirrors un-mirrored sessions and reports synced/remaining', async () => {
    // count calls in order: candidates=1, stillNull=0, remaining=0
    h.sessionCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    // first findMany = the slice; second (inside syncSessionsToGoogle) = full rows
    h.sessionFindMany
      .mockResolvedValueOnce([{ id: 's1' }])
      .mockResolvedValueOnce([
        { id: 's1', trainerId: 'co-1', assignedMembershipId: null, title: 'Train together Thursday', description: null, location: null, scheduledAt: new Date('2026-08-01T09:00:00Z'), durationMins: 60, googleCalendarEventId: null },
      ])
    h.upsertCalendarEvent.mockResolvedValue('evt-1')

    const res = await backfillSessionsToGoogle({ execute: true })

    expect(h.upsertCalendarEvent).toHaveBeenCalledTimes(1)
    // routed to the owner's connection (session was unassigned)
    expect(h.upsertCalendarEvent).toHaveBeenCalledWith(ownerConn, null, expect.objectContaining({ summary: 'Train together Thursday' }))
    expect(h.sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' }, data: { googleCalendarEventId: 'evt-1' } }))
    expect(res).toEqual({ activeCompanies: 1, candidates: 1, synced: 1, remaining: 0 })
  })
})
