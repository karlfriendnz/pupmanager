import { describe, it, expect, vi, beforeEach } from 'vitest'

// A drop-in is a booking for ONE session, so the same client can drop into
// several sessions of the same run — one enrolment row each. What must not
// happen is double-booking: the same session twice, or a drop-in sitting
// alongside a FULL enrolment that already covers every session (they'd be
// billed twice for the same seat).
const h = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  enrFindFirst: vi.fn(),
  enrCount: vi.fn(),
  enrGroupBy: vi.fn(),
  enrAggregate: vi.fn(),
  enrCreate: vi.fn(),
  enrUpdate: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    classRun: { findUnique: h.runFindUnique },
    trainingSession: { findFirst: h.sessionFindFirst },
    classEnrollment: {
      findFirst: h.enrFindFirst,
      count: h.enrCount,
      groupBy: h.enrGroupBy,
      aggregate: h.enrAggregate,
      create: h.enrCreate,
      update: h.enrUpdate,
    },
  }
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } }
})

import { enrollInRun, ClassError } from '@/lib/class-runs'

const RUN = 'run_1'
const CLIENT = 'cl_1'
const SESSION_A = 'sess_a'
const SESSION_B = 'sess_b'

/** A live enrolment row as the conflict lookups see it. */
const live = (dropInSessionId: string | null) => ({
  id: `enr_${dropInSessionId ?? 'full'}`, status: 'ENROLLED', dropInSessionId,
})

const dropIn = (sessionId: string) =>
  enrollInRun({ classRunId: RUN, clientId: CLIENT, type: 'DROP_IN', sessionId, source: 'TRAINER' })

beforeEach(() => {
  vi.clearAllMocks()
  h.runFindUnique.mockResolvedValue({
    id: RUN, status: 'SCHEDULED', capacity: null,
    package: { allowDropIn: true, allowWaitlist: false, capacity: null },
  })
  h.sessionFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id, sessionIndex: 1, status: 'UPCOMING',
    scheduledAt: new Date(Date.now() + 7 * 24 * 3600_000),
    packageSessionSlot: null,
  }))
  h.enrFindFirst.mockResolvedValue(null) // no clashes by default
  h.enrCount.mockResolvedValue(0)
  h.enrGroupBy.mockResolvedValue([])
  h.enrAggregate.mockResolvedValue({ _max: { waitlistPosition: 0 } })
  h.enrCreate.mockImplementation(async ({ data }: { data: object }) => ({ id: 'enr_new', ...data }))
  h.enrUpdate.mockImplementation(async ({ data }: { data: object }) => ({ id: 'enr_reused', ...data }))
})

describe('enrollInRun — drop-in across several sessions', () => {
  it('books a drop-in against the session it was given', async () => {
    const r = await dropIn(SESSION_A)
    expect(r.status).toBe('ENROLLED')
    expect(h.enrCreate.mock.calls[0][0].data).toMatchObject({
      classRunId: RUN, clientId: CLIENT, type: 'DROP_IN', dropInSessionId: SESSION_A,
    })
  })

  // The point of the change: a second session is a second booking, not a
  // duplicate. The clash lookup has to be scoped to the session.
  it('lets the same client drop into a different session of the same run', async () => {
    // A live drop-in exists for session A — but we're booking session B, so
    // the session-scoped lookup finds nothing.
    h.enrFindFirst.mockImplementation(async ({ where }: { where: { dropInSessionId?: string | null } }) =>
      where.dropInSessionId === SESSION_A ? live(SESSION_A) : null)
    const r = await dropIn(SESSION_B)
    expect(r.status).toBe('ENROLLED')
    expect(h.enrCreate.mock.calls[0][0].data).toMatchObject({ dropInSessionId: SESSION_B })
  })

  it('refuses a second booking for a session they already hold', async () => {
    h.enrFindFirst.mockImplementation(async ({ where }: { where: { dropInSessionId?: string | null } }) =>
      where.dropInSessionId === SESSION_A ? live(SESSION_A) : null)
    await expect(dropIn(SESSION_A)).rejects.toThrow(ClassError)
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  // A FULL enrolment already puts them in every session of the run.
  it('refuses a drop-in when they hold a full enrolment', async () => {
    h.enrFindFirst.mockImplementation(async ({ where }: { where: { dropInSessionId?: string | null } }) =>
      where.dropInSessionId === null ? live(null) : null)
    await expect(dropIn(SESSION_A)).rejects.toThrow(/whole class/i)
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  // …and the same the other way round, or those sessions get billed twice.
  it('refuses a full enrolment when they hold drop-in bookings', async () => {
    h.enrCount.mockImplementation(async ({ where }: { where: { dropInSessionId?: unknown } }) =>
      where.dropInSessionId && typeof where.dropInSessionId === 'object' ? 2 : 0)
    await expect(
      enrollInRun({ classRunId: RUN, clientId: CLIENT, type: 'FULL', source: 'TRAINER' }),
    ).rejects.toThrow(/drop-in sessions booked/i)
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  // A withdrawn row for that same session is reused rather than duplicated.
  it('reuses a withdrawn booking for the same session', async () => {
    h.enrFindFirst.mockImplementation(async ({ where }: { where: { dropInSessionId?: string | null } }) =>
      where.dropInSessionId === SESSION_A
        ? { id: 'enr_old', status: 'WITHDRAWN', dropInSessionId: SESSION_A }
        : null)
    await dropIn(SESSION_A)
    expect(h.enrCreate).not.toHaveBeenCalled()
    expect(h.enrUpdate.mock.calls[0][0].where).toEqual({ id: 'enr_old' })
  })

  it('still refuses a drop-in with no session named', async () => {
    await expect(
      enrollInRun({ classRunId: RUN, clientId: CLIENT, type: 'DROP_IN', source: 'TRAINER' }),
    ).rejects.toThrow(/Pick which session/i)
  })
})
