import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route planner used to select `clientId: { not: null }`, which meant it
// only ever saw 1:1 sessions. Group classes, casual/drop-in classes, one-off
// events and doggy daycare are ALL TrainingSession rows with a classRunId and
// a null clientId, so a trainer whose Tuesday was a puppy class plus a daycare
// day got a "route" with nothing on it.
//
// These tests pin the four things that were wrong or newly decided:
//   1. every kind of booking becomes a stop
//   2. a venue with no coordinates is still routable (address waypoint)
//   3. a booking with nowhere to drive to is REPORTED, not dropped
//   4. the day-parts of one daycare run are ONE arrival, not three
const h = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { trainingSession: { findMany: h.findMany } },
}))

import { getDayStops } from '@/lib/route-day'

const TZ = 'Pacific/Auckland'
const DATE = '2026-08-04'
// 2026-08-04 09:00 NZST == 2026-08-03 21:00Z.
const at = (hour: number, min = 0) => new Date(Date.UTC(2026, 7, 3, hour - 12, min))

type Pkg = {
  isGroup: boolean
  allowDropIn: boolean
  sessionCount: number
  recurrenceRule: string | null
  isPuppySchool: boolean
}

const GROUP_PKG: Pkg = {
  isGroup: true, allowDropIn: false, sessionCount: 6,
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU', isPuppySchool: false,
}
const EVENT_PKG: Pkg = {
  isGroup: true, allowDropIn: false, sessionCount: 1,
  recurrenceRule: null, isPuppySchool: false,
}
const DROPIN_PKG: Pkg = {
  isGroup: true, allowDropIn: true, sessionCount: 0,
  recurrenceRule: null, isPuppySchool: false,
}
const DAYCARE_PKG: Pkg = {
  isGroup: true, allowDropIn: true, sessionCount: 0,
  recurrenceRule: null, isPuppySchool: true,
}

function groupSession(over: {
  id: string
  runId: string
  runName: string
  pkg: Pkg
  at: Date
  location?: string | null
  sessionLocation?: string | null
  sessionType?: 'IN_PERSON' | 'VIRTUAL'
  durationMins?: number
  enrollments?: number
}) {
  return {
    id: over.id,
    scheduledAt: over.at,
    durationMins: over.durationMins ?? 60,
    sessionType: over.sessionType ?? 'IN_PERSON',
    location: over.sessionLocation ?? null,
    classRunId: over.runId,
    dog: null,
    client: null,
    classRun: {
      id: over.runId,
      name: over.runName,
      location: over.location === undefined ? 'Memorial Park, Tauranga' : over.location,
      package: over.pkg,
      _count: { enrollments: over.enrollments ?? 4 },
    },
  }
}

function clientSession(over: {
  id: string
  clientId: string
  name: string
  at: Date
  lat?: number | null
  lng?: number | null
  dog?: string | null
  sessionType?: 'IN_PERSON' | 'VIRTUAL'
  durationMins?: number
}) {
  return {
    id: over.id,
    scheduledAt: over.at,
    durationMins: over.durationMins ?? 45,
    sessionType: over.sessionType ?? 'IN_PERSON',
    location: null,
    classRunId: null,
    dog: over.dog ? { name: over.dog } : null,
    client: {
      id: over.clientId,
      addressLine: over.lat == null ? null : '12 Somewhere Rd',
      addressLat: over.lat ?? null,
      addressLng: over.lng ?? null,
      user: { name: over.name, email: `${over.clientId}@example.com` },
    },
    classRun: null,
  }
}

beforeEach(() => {
  h.findMany.mockReset()
})

describe('getDayStops — the whole schedule, not just 1:1', () => {
  it('makes a stop out of every kind of booking', async () => {
    h.findMany.mockResolvedValue([
      clientSession({ id: 's1', clientId: 'c1', name: 'Lucy Bennett', at: at(9), lat: -37.6, lng: 176.1, dog: 'Scout' }),
      groupSession({ id: 's2', runId: 'r1', runName: 'Puppy Foundations', pkg: GROUP_PKG, at: at(11) }),
      groupSession({ id: 's3', runId: 'r2', runName: 'Saturday Social', pkg: DROPIN_PKG, at: at(13) }),
      groupSession({ id: 's4', runId: 'r3', runName: 'Scentwork Day', pkg: EVENT_PKG, at: at(15) }),
      groupSession({ id: 's5', runId: 'r4', runName: 'Waggy Tails Daycare', pkg: DAYCARE_PKG, at: at(17) }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)

    expect(stops.map(s => s.kindLabel)).toEqual(['1:1', 'Class', 'Casual class', 'Event', 'Daycare'])
    // Nothing is blocked — the client is geocoded, the runs all have a venue.
    expect(stops.every(s => s.blocked === null)).toBe(true)
  })

  it('links each group stop to its own section of the app', async () => {
    h.findMany.mockResolvedValue([
      groupSession({ id: 's1', runId: 'r1', runName: 'Class', pkg: GROUP_PKG, at: at(9) }),
      groupSession({ id: 's2', runId: 'r2', runName: 'Drop-in', pkg: DROPIN_PKG, at: at(10) }),
      groupSession({ id: 's3', runId: 'r3', runName: 'Event', pkg: EVENT_PKG, at: at(11) }),
      groupSession({ id: 's4', runId: 'r4', runName: 'Daycare', pkg: DAYCARE_PKG, at: at(12) }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops.map(s => s.href)).toEqual([
      '/classes/r1', '/casual-classes/r2', '/events/r3', '/doggy-daycare/r4',
    ])
  })

  it('routes a free-text venue with no coordinates', async () => {
    // ClassRun.location is free text by design — "the field behind the hall"
    // is a valid answer and there is nowhere in the schema to geocode it. The
    // stop must still be routable; it goes to the Routes API as an address.
    h.findMany.mockResolvedValue([
      groupSession({
        id: 's1', runId: 'r1', runName: 'Recall Club', pkg: GROUP_PKG, at: at(10),
        location: 'the field behind the hall',
      }),
    ])

    const [stop] = await getDayStops('co_1', DATE, TZ)
    expect(stop.blocked).toBeNull()
    expect(stop.address).toBe('the field behind the hall')
    expect(stop.lat).toBeNull()
    expect(stop.lng).toBeNull()
  })

  it('prefers a per-session venue over the run default', async () => {
    h.findMany.mockResolvedValue([
      groupSession({
        id: 's1', runId: 'r1', runName: 'Recall Club', pkg: GROUP_PKG, at: at(10),
        location: 'Memorial Park', sessionLocation: 'Fergusson Park (this week)',
      }),
    ])

    const [stop] = await getDayStops('co_1', DATE, TZ)
    expect(stop.address).toBe('Fergusson Park (this week)')
  })
})

describe('getDayStops — stops with nowhere to drive to', () => {
  it('reports a run with no venue instead of dropping it', async () => {
    h.findMany.mockResolvedValue([
      groupSession({ id: 's1', runId: 'r1', runName: 'Unlocated Class', pkg: GROUP_PKG, at: at(10), location: null }),
    ])

    const [stop] = await getDayStops('co_1', DATE, TZ)
    expect(stop.blocked).toBe('no-location')
    // Still linked, so the trainer can go and add one.
    expect(stop.href).toBe('/classes/r1')
  })

  it('keeps a virtual session off the driving route', async () => {
    h.findMany.mockResolvedValue([
      clientSession({ id: 's1', clientId: 'c1', name: 'Ella Young', at: at(10), lat: -37.6, lng: 176.1, sessionType: 'VIRTUAL' }),
      groupSession({ id: 's2', runId: 'r1', runName: 'Online Q&A', pkg: GROUP_PKG, at: at(11), sessionType: 'VIRTUAL' }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops.map(s => s.blocked)).toEqual(['virtual', 'virtual'])
  })

  it('un-blocks a client who is also seen in person that day', async () => {
    // A morning video call and an afternoon home visit for the same client is
    // one stop, and the trainer does have to drive to it.
    h.findMany.mockResolvedValue([
      clientSession({ id: 's1', clientId: 'c1', name: 'Ella Young', at: at(9), lat: -37.6, lng: 176.1, sessionType: 'VIRTUAL' }),
      clientSession({ id: 's2', clientId: 'c1', name: 'Ella Young', at: at(14), lat: -37.6, lng: 176.1 }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops).toHaveLength(1)
    expect(stops[0].blocked).toBeNull()
  })

  it('reports a client with no address on file', async () => {
    h.findMany.mockResolvedValue([
      clientSession({ id: 's1', clientId: 'c1', name: 'No Address', at: at(10), lat: null, lng: null }),
    ])

    const [stop] = await getDayStops('co_1', DATE, TZ)
    expect(stop.blocked).toBe('no-address')
  })
})

describe('getDayStops — merging', () => {
  it('folds a daycare run\'s day-parts into one arrival', async () => {
    h.findMany.mockResolvedValue([
      groupSession({ id: 's1', runId: 'r1', runName: 'Waggy Tails', pkg: DAYCARE_PKG, at: at(8), durationMins: 120 }),
      groupSession({ id: 's2', runId: 'r1', runName: 'Waggy Tails', pkg: DAYCARE_PKG, at: at(12), durationMins: 120 }),
      groupSession({ id: 's3', runId: 'r1', runName: 'Waggy Tails', pkg: DAYCARE_PKG, at: at(15), durationMins: 60 }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops).toHaveLength(1)
    // Earliest start, latest end, all three day-parts' minutes.
    expect(stops[0].time).toBe('8:00am')
    expect(stops[0].endTime).toBe('4:00pm')
    expect(stops[0].visitMins).toBe(300)
  })

  it('keeps one run at two venues on the same day as two arrivals', async () => {
    h.findMany.mockResolvedValue([
      groupSession({ id: 's1', runId: 'r1', runName: 'Drop-in', pkg: DROPIN_PKG, at: at(9), location: 'Memorial Park' }),
      groupSession({ id: 's2', runId: 'r1', runName: 'Drop-in', pkg: DROPIN_PKG, at: at(16), location: 'Bayfair' }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops).toHaveLength(2)
    expect(stops.map(s => s.address)).toEqual(['Memorial Park', 'Bayfair'])
  })

  it('collects every dog visited at one household', async () => {
    h.findMany.mockResolvedValue([
      clientSession({ id: 's1', clientId: 'c1', name: 'Sarah Scott', at: at(9), lat: -37.6, lng: 176.1, dog: 'Koda' }),
      clientSession({ id: 's2', clientId: 'c1', name: 'Sarah Scott', at: at(10), lat: -37.6, lng: 176.1, dog: 'Bailey' }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops).toHaveLength(1)
    expect(stops[0].dogs.sort()).toEqual(['Bailey', 'Koda'])
  })

  it('returns stops in booked-time order', async () => {
    h.findMany.mockResolvedValue([
      groupSession({ id: 's1', runId: 'r1', runName: 'Late class', pkg: GROUP_PKG, at: at(17) }),
      clientSession({ id: 's2', clientId: 'c1', name: 'Early visit', at: at(8), lat: -37.6, lng: 176.1 }),
    ])

    const stops = await getDayStops('co_1', DATE, TZ)
    expect(stops.map(s => s.name)).toEqual(['Early visit', 'Late class'])
  })
})

describe('getDayStops — member scoping', () => {
  it('matches a class staffed on the RUN, not just on the session', async () => {
    // ClassRunTrainer is how a class is assigned to a team member; filtering on
    // the session's own assignedMembershipId alone hid a member's whole class
    // from their own route.
    h.findMany.mockResolvedValue([])
    await getDayStops('co_1', DATE, TZ, 'mem_1')

    const where = h.findMany.mock.calls[0][0].where
    const scoping = where.AND.find((c: Record<string, unknown>) =>
      Array.isArray(c.OR) && c.OR.some((o: Record<string, unknown>) => 'assignedMembershipId' in o))
    expect(scoping).toBeDefined()
    expect(scoping.OR).toContainEqual({
      classRun: { assignedTrainers: { some: { membershipId: 'mem_1' } } },
    })
  })

  it('does not scope when asked for all trainers', async () => {
    h.findMany.mockResolvedValue([])
    await getDayStops('co_1', DATE, TZ, 'all')

    const where = h.findMany.mock.calls[0][0].where
    // Only the "is this attributable to anything" clause remains.
    expect(where.AND).toHaveLength(1)
  })
})
