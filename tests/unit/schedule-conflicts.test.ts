import { describe, it, expect, vi, beforeEach } from 'vitest'
import { conflictMessage, findDropClashes, clashesToConflictResult, type ExistingSlot } from '@/lib/use-booking-conflicts'

// ── Drag-drop multi-session overlap (the PRE-move confirm gate) ───────────────
describe('findDropClashes', () => {
  const at = (iso: string, durationMins = 60, extra: Partial<ExistingSlot> = {}): ExistingSlot => ({
    id: Math.random().toString(36).slice(2), title: 'S', scheduledAt: iso, durationMins, ...extra,
  })

  it('flags a direct overlap for the single dragged session', () => {
    const moved = [{ id: 'drag', scheduledAt: '2026-07-10T09:00:00Z', durationMins: 60 }]
    const existing = [at('2026-07-10T09:30:00Z', 60, { id: 'other', title: 'Bailey walk' })]
    const clashes = findDropClashes(moved, existing)
    expect(clashes.map(c => c.id)).toEqual(['other'])
  })

  it('fires when the dragged slot is CLEAR but a package follower lands on a clash', () => {
    // Dragged 9:00 is free; its follower shifts to 11:00 and collides with an existing 11:00.
    const moved = [
      { id: 'drag', scheduledAt: '2026-07-10T09:00:00Z', durationMins: 60 },
      { id: 'follower', scheduledAt: '2026-07-10T11:00:00Z', durationMins: 60 },
    ]
    const existing = [
      at('2026-07-10T09:00:00Z', 60, { id: 'drag' }),        // itself — excluded by caller anyway
      at('2026-07-10T11:15:00Z', 60, { id: 'clashWithFollower', title: 'Max' }),
    ].filter(s => s.id !== 'drag')
    const clashes = findDropClashes(moved, existing)
    expect(clashes.map(c => c.id)).toEqual(['clashWithFollower'])
  })

  it('detects a solo-trainer / unassigned overlap (helper is not membership-scoped)', () => {
    // No membership info anywhere — a pure interval overlap still clashes.
    const moved = [{ id: 'drag', scheduledAt: '2026-07-10T14:00:00Z', durationMins: 90 }]
    const existing = [at('2026-07-10T15:00:00Z', 60, { id: 'unassigned', title: 'Own booking' })]
    expect(findDropClashes(moved, existing)).toHaveLength(1)
  })

  it('flags a 1:1 dropped onto a group-class time, labelled by the class', () => {
    const moved = [{ id: 'oneToOne', scheduledAt: '2026-07-10T10:00:00Z', durationMins: 60 }]
    const existing = [at('2026-07-10T10:15:00Z', 60, { id: 'cls', title: 'Puppy Class', classRunId: 'run-1', label: 'Puppy Class' })]
    const clashes = findDropClashes(moved, existing)
    expect(clashes).toHaveLength(1)
    expect(clashes[0].label).toBe('Puppy Class')
  })

  it('does NOT clash two occurrences of the SAME class run', () => {
    const moved = [{ id: 'occ-a', scheduledAt: '2026-07-10T10:00:00Z', durationMins: 60, classRunId: 'run-1' }]
    const existing = [at('2026-07-10T10:15:00Z', 60, { id: 'occ-b', classRunId: 'run-1' })]
    expect(findDropClashes(moved, existing)).toHaveLength(0)
  })

  it('DOES clash a class session against a DIFFERENT class run at the same time', () => {
    const moved = [{ id: 'occ-a', scheduledAt: '2026-07-10T10:00:00Z', durationMins: 60, classRunId: 'run-1' }]
    const existing = [at('2026-07-10T10:00:00Z', 60, { id: 'occ-b', classRunId: 'run-2' })]
    expect(findDropClashes(moved, existing)).toHaveLength(1)
  })

  it('ignores non-overlapping and self (moved) sessions, and de-dupes', () => {
    const moved = [
      { id: 'a', scheduledAt: '2026-07-10T09:00:00Z', durationMins: 60 },
      { id: 'b', scheduledAt: '2026-07-10T09:30:00Z', durationMins: 60 },
    ]
    const existing = [
      at('2026-07-10T09:15:00Z', 60, { id: 'shared' }), // overlaps BOTH a and b → counted once
      at('2026-07-10T20:00:00Z', 60, { id: 'far' }),    // no overlap
      at('2026-07-10T09:00:00Z', 60, { id: 'a' }),      // is a moved id
    ]
    expect(findDropClashes(moved, existing).map(c => c.id)).toEqual(['shared'])
  })
})

describe('clashesToConflictResult', () => {
  it('maps clashes + Google busy into the shared ConflictResult shape', () => {
    const result = clashesToConflictResult(
      [{ id: 'x', title: 'T', scheduledAt: '2026-07-10T10:00:00Z', durationMins: 60, label: 'Sarah & Bailey' }],
      [{ startsAt: '2026-07-10T10:00:00Z', endsAt: '2026-07-10T10:30:00Z', title: 'Dentist' }],
    )
    expect(result.sessionConflicts[0]).toMatchObject({ id: 'x', label: 'Sarah & Bailey' })
    expect(result.busyConflicts[0].title).toBe('Dentist')
    // And it feeds a non-null confirm message (i.e. it WOULD pop the modal).
    expect(conflictMessage(result)).toContain('Book anyway?')
  })
})

// ── Pure message builder (the confirm prompt text) ───────────────────────────
describe('conflictMessage', () => {
  const empty = { sessionConflicts: [], busyConflicts: [] }
  it('returns null when there is no clash', () => {
    expect(conflictMessage(empty)).toBeNull()
  })
  it('names an own-session clash by label', () => {
    const msg = conflictMessage({ sessionConflicts: [{ id: 's', title: 'Walk', scheduledAt: '', durationMins: 60, label: 'Sarah & Bailey' }], busyConflicts: [] })
    expect(msg).toContain('a session with Sarah & Bailey')
    expect(msg).toContain('Book anyway?')
  })
  it('names a Google clash and merges both sources', () => {
    const msg = conflictMessage({
      sessionConflicts: [{ id: 's', title: 'Walk', scheduledAt: '', durationMins: 60, label: null }],
      busyConflicts: [{ startsAt: '', endsAt: '' }],
    })
    expect(msg).toContain('a session (“Walk”)') // falls back to title when unlabelled
    expect(msg).toContain('a Google Calendar event')
  })
  it('says "another session" only when both label and title are absent', () => {
    const msg = conflictMessage({ sessionConflicts: [{ id: 's', title: '', scheduledAt: '', durationMins: 60, label: null }], busyConflicts: [] })
    expect(msg).toContain('another session')
  })
})

// ── The shared conflicts endpoint ────────────────────────────────────────────
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  membershipFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  busyFindMany: vi.fn(),
  connFindUnique: vi.fn(),
  hasAddon: vi.fn(),
  fetchCalendarEvents: vi.fn(),
}))
vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({ fetchCalendarEvents: h.fetchCalendarEvents }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findFirst: h.membershipFindFirst },
    trainingSession: { findMany: h.sessionFindMany },
    googleBusyBlock: { findMany: h.busyFindMany },
    googleCalendarConnection: { findUnique: h.connFindUnique },
  },
}))

import { GET } from '@/app/api/schedule/conflicts/route'

const START = '2026-07-10T09:00:00.000Z'
const END = '2026-07-10T10:00:00.000Z'
const url = (extra = '') => new Request(`http://localhost/api/schedule/conflicts?start=${START}&end=${END}${extra}`)

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue({ userId: 'u', companyId: 'co1', membershipId: 'mem-owner', role: 'OWNER', permissions: {} })
  // owner lookup + membership validation both go through findFirst
  h.membershipFindFirst.mockImplementation(({ where }: { where: { role?: string; id?: string } }) =>
    Promise.resolve(where.role === 'OWNER' ? { id: 'mem-owner' } : where.id ? { id: where.id } : null),
  )
  h.sessionFindMany.mockResolvedValue([])
  h.busyFindMany.mockResolvedValue([])
  // Default: add-on OFF → live path skipped, cached fallback used (busyFindMany).
  h.hasAddon.mockResolvedValue(false)
  h.connFindUnique.mockResolvedValue(null)
  h.fetchCalendarEvents.mockResolvedValue([])
})

describe('GET /api/schedule/conflicts', () => {
  it('flags an own-session that overlaps the window (and filters non-overlapping ones)', async () => {
    h.sessionFindMany.mockResolvedValue([
      { id: 'a', title: 'Overlap', scheduledAt: new Date('2026-07-10T09:30:00Z'), durationMins: 60, client: { user: { name: 'Sarah' } }, dog: null, classRun: null, clientPackage: null },
      { id: 'b', title: 'Earlier', scheduledAt: new Date('2026-07-10T07:00:00Z'), durationMins: 30, client: null, dog: null, classRun: null, clientPackage: null },
    ])
    const body = await (await GET(url())).json()
    expect(body.sessionConflicts).toHaveLength(1)
    expect(body.sessionConflicts[0]).toMatchObject({ id: 'a', label: 'Sarah' })
  })

  it('scopes to the requested member — another member’s sessions are excluded by the query filter', async () => {
    await GET(url('&membershipId=mem-x'))
    const where = h.sessionFindMany.mock.calls[0][0].where
    // A specific member → exact assignedMembershipId match (NOT the owner OR-clause).
    expect(where.assignedMembershipId).toBe('mem-x')
    expect(where.trainerId).toBe('co1')
  })

  it('treats an unassigned/owner booking as owner-run (null OR owner membership)', async () => {
    await GET(url())
    const where = h.sessionFindMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ assignedMembershipId: null }, { assignedMembershipId: 'mem-owner' }])
  })

  it('merges cached Google busy blocks when the live check is unavailable', async () => {
    h.busyFindMany.mockResolvedValue([{ startsAt: new Date('2026-07-10T09:15:00Z'), endsAt: new Date('2026-07-10T09:45:00Z') }])
    const body = await (await GET(url())).json()
    expect(body.busyConflicts).toHaveLength(1)
  })

  it('does a LIVE events lookup for the window when connected (not the cache), with the title', async () => {
    h.hasAddon.mockResolvedValue(true)
    h.connFindUnique.mockResolvedValue({ id: 'gc', membershipId: 'mem-owner', companyId: 'co1', calendarId: 'primary' })
    h.fetchCalendarEvents.mockResolvedValue([{ start: new Date('2026-07-10T09:30:00Z'), end: new Date('2026-07-10T09:50:00Z'), title: 'Dentist' }])

    const body = await (await GET(url())).json()

    expect(h.fetchCalendarEvents).toHaveBeenCalled()
    expect(h.busyFindMany).not.toHaveBeenCalled() // live path, not the cache
    expect(body.busyConflicts).toHaveLength(1)
    expect(body.busyConflicts[0].title).toBe('Dentist')
  })

  it('falls back to the cached blocks if the live events call throws', async () => {
    h.hasAddon.mockResolvedValue(true)
    h.connFindUnique.mockResolvedValue({ id: 'gc', membershipId: 'mem-owner', companyId: 'co1', calendarId: 'primary' })
    h.fetchCalendarEvents.mockRejectedValue(new Error('google 500'))
    h.busyFindMany.mockResolvedValue([{ startsAt: new Date('2026-07-10T09:15:00Z'), endsAt: new Date('2026-07-10T09:45:00Z') }])

    const body = await (await GET(url())).json()
    expect(body.busyConflicts).toHaveLength(1) // cached fallback kept the result
  })

  it('is empty when nothing clashes', async () => {
    const body = await (await GET(url())).json()
    expect(body).toEqual({ sessionConflicts: [], busyConflicts: [] })
  })

  it('passes excludeSessionId so a rescheduled session never clashes with itself', async () => {
    await GET(url('&excludeSessionId=self-1'))
    expect(h.sessionFindMany.mock.calls[0][0].where.id).toEqual({ not: 'self-1' })
  })

  it('is best-effort: a DB error yields empty arrays, not a 500', async () => {
    h.sessionFindMany.mockRejectedValue(new Error('db down'))
    const res = await GET(url())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessionConflicts: [], busyConflicts: [] })
  })
})
