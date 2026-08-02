import { describe, it, expect, vi, beforeEach } from 'vitest'

// Default homework — the tasks an offering suggests after a session, which the
// trainer confirms in one tap. These cover the two things that can go wrong
// quietly: suggesting the WRONG session's tasks, and handing the same task out
// twice.

const h = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  defaultFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  createManyAndReturn: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst, findMany: h.sessionFindMany },
    packageDefaultTask: { findMany: h.defaultFindMany },
    trainingTask: { findMany: h.taskFindMany, createManyAndReturn: h.createManyAndReturn },
  },
}))

import { suggestedHomeworkForSession, assignDefaults, type SuggestedTask } from '@/lib/default-homework'

const lib = (id: string, title: string) => ({ id, title, description: 'from library', repetitions: 5, videoUrl: null })

beforeEach(() => {
  h.sessionFindFirst.mockReset()
  h.sessionFindMany.mockReset()
  h.defaultFindMany.mockReset()
  h.taskFindMany.mockReset()
  h.createManyAndReturn.mockReset()
  h.createManyAndReturn.mockImplementation(async ({ data }: { data: unknown[] }) => data)
})

describe('suggestedHomeworkForSession', () => {
  it('uses the class run\'s own session number and reads library text live', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's1', clientId: null, sessionIndex: 3, clientPackageId: null, classRunId: 'r1',
      classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Puppy Class' } },
      clientPackage: null,
    })
    h.defaultFindMany.mockResolvedValue([
      { id: 'd1', order: 0, title: null, description: null, repetitions: null, videoUrl: null, libraryTask: lib('L1', 'Loose lead') },
    ])

    const out = await suggestedHomeworkForSession('s1', 'co1')

    expect(out?.sessionIndex).toBe(3)
    expect(out?.isGroup).toBe(true)
    // Only this session's rows plus the "every session" ones are asked for.
    expect(h.defaultFindMany.mock.calls[0][0].where.OR).toEqual([{ sessionIndex: null }, { sessionIndex: 3 }])
    // The library item is the source of truth, not a stale copy on the default.
    expect(out?.tasks[0]).toMatchObject({ title: 'Loose lead', description: 'from library', repetitions: 5, libraryTaskId: 'L1' })
  })

  it('numbers a 1:1 session by its place on the calendar, not creation order', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's2', clientId: 'c1', sessionIndex: null, clientPackageId: 'cp1', classRunId: null,
      classRun: null,
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Puppy 1:1 Session' } },
    })
    h.sessionFindMany.mockResolvedValue([{ id: 's9' }, { id: 's2' }, { id: 's7' }])
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('s2', 'co1')

    expect(out?.sessionIndex).toBe(2)
    expect(out?.isGroup).toBe(false)
    expect(out?.clientId).toBe('c1')
  })

  it('falls back to only the "every session" rows when the session has no number', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's3', clientId: 'c1', sessionIndex: null, clientPackageId: 'cp1', classRunId: null,
      classRun: null,
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Ongoing' } },
    })
    // The session isn't among its package's sessions — no position to take.
    h.sessionFindMany.mockResolvedValue([{ id: 'other' }])
    h.defaultFindMany.mockResolvedValue([])

    await suggestedHomeworkForSession('s3', 'co1')

    expect(h.defaultFindMany.mock.calls[0][0].where.OR).toEqual([{ sessionIndex: null }])
  })

  it('returns null for a session that is not part of an offering', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's4', clientId: 'c1', sessionIndex: null, clientPackageId: null, classRunId: null,
      classRun: null, clientPackage: null,
    })
    expect(await suggestedHomeworkForSession('s4', 'co1')).toBeNull()
  })

  it('returns null for another trainer\'s session', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    expect(await suggestedHomeworkForSession('s5', 'other-co')).toBeNull()
    expect(h.defaultFindMany).not.toHaveBeenCalled()
  })

  it('takes before/after from the offering\'s row, never from the library item', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's1', clientId: null, sessionIndex: 1, clientPackageId: null, classRunId: 'r1',
      classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Puppy Class' } },
      clientPackage: null,
    })
    // The SAME library item can be preparation on one offering and practice on
    // another, so the flag belongs to the offering's row — this is the whole
    // reason it isn't a column on LibraryTask.
    h.defaultFindMany.mockResolvedValue([
      { id: 'd1', order: 0, timing: 'BEFORE_SESSION', title: null, description: null, repetitions: null, videoUrl: null, libraryTask: lib('L1', 'Bring a pot of chicken') },
      { id: 'd2', order: 1, timing: 'AFTER_SESSION', title: null, description: null, repetitions: null, videoUrl: null, libraryTask: lib('L2', 'Practise the recall') },
    ])

    const out = await suggestedHomeworkForSession('s1', 'co1')
    expect(out?.tasks.map(t => t.timing)).toEqual(['BEFORE_SESSION', 'AFTER_SESSION'])
  })

  it('drops a default with nothing to name it', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's6', clientId: null, sessionIndex: 1, clientPackageId: null, classRunId: 'r1',
      classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Class' } },
      clientPackage: null,
    })
    h.defaultFindMany.mockResolvedValue([
      { id: 'd1', order: 0, title: null, description: null, repetitions: null, videoUrl: null, libraryTask: null },
      { id: 'd2', order: 1, title: 'Crate rest', description: null, repetitions: null, videoUrl: null, libraryTask: null },
    ])

    const out = await suggestedHomeworkForSession('s6', 'co1')
    expect(out?.tasks.map(t => t.title)).toEqual(['Crate rest'])
  })
})

describe('assignDefaults', () => {
  const tasks: SuggestedTask[] = [
    { id: 'd1', libraryTaskId: 'L1', title: 'Loose lead', description: 'walk nicely', repetitions: 5, videoUrl: null, timing: 'AFTER_SESSION', order: 0 },
    { id: 'd2', libraryTaskId: null, title: 'Crate rest', description: null, repetitions: null, videoUrl: null, timing: 'AFTER_SESSION', order: 1 },
  ]

  it('carries the offering\'s before/after flag onto the handed-out task', async () => {
    h.taskFindMany.mockResolvedValue([])
    const created = await assignDefaults({
      tasks: [
        { id: 'd0', libraryTaskId: null, title: 'Bring a hungry dog', description: null, repetitions: null, videoUrl: null, timing: 'BEFORE_SESSION', order: 0 },
        ...tasks,
      ],
      clientIds: ['c1'],
      sessionId: 's1',
      date: new Date('2026-08-01T00:00:00.000Z'),
    })

    // A snapshot, like the text — re-flagging the offering afterwards must not
    // rewrite work already given out.
    expect(created.map(r => r.timing)).toEqual(['BEFORE_SESSION', 'AFTER_SESSION', 'AFTER_SESSION'])
  })

  it('gives every client every task, on the right dog', async () => {
    h.taskFindMany.mockResolvedValue([])
    const created = await assignDefaults({
      tasks,
      clientIds: ['c1', 'c2'],
      sessionId: 's1',
      date: new Date('2026-08-01T00:00:00.000Z'),
      dogIdByClient: { c1: 'dog1', c2: null },
    })

    expect(created).toHaveLength(4)
    expect(created.filter(r => r.clientId === 'c1').every(r => r.dogId === 'dog1')).toBe(true)
    expect(created.filter(r => r.clientId === 'c2').every(r => r.dogId === null)).toBe(true)
    // Snapshot, with the library link kept only as provenance.
    expect(created[0]).toMatchObject({ title: 'Loose lead', description: 'walk nicely', libraryTaskId: 'L1', sessionId: 's1' })
  })

  it('never hands a client something they already have on this session', async () => {
    h.taskFindMany.mockResolvedValue([
      // c1 has the library one (matched by id, so a rename can't fool it)…
      { clientId: 'c1', title: 'Renamed since', libraryTaskId: 'L1', order: 0 },
      // …and c2 has the inline one, matched on title.
      { clientId: 'c2', title: 'crate rest', libraryTaskId: null, order: 2 },
    ])

    const created = await assignDefaults({
      tasks, clientIds: ['c1', 'c2'], sessionId: 's1', date: new Date('2026-08-01T00:00:00.000Z'),
    })

    expect(created.filter(r => r.clientId === 'c1').map(r => r.title)).toEqual(['Crate rest'])
    expect(created.filter(r => r.clientId === 'c2').map(r => r.title)).toEqual(['Loose lead'])
    // New rows append after what the client already had, per client.
    expect(created.find(r => r.clientId === 'c2')?.order).toBe(3)
  })

  it('writes nothing when everyone already has everything', async () => {
    h.taskFindMany.mockResolvedValue([
      { clientId: 'c1', title: 'Loose lead', libraryTaskId: 'L1', order: 0 },
      { clientId: 'c1', title: 'Crate rest', libraryTaskId: null, order: 1 },
    ])
    const created = await assignDefaults({
      tasks, clientIds: ['c1'], sessionId: 's1', date: new Date('2026-08-01T00:00:00.000Z'),
    })
    expect(created).toEqual([])
    expect(h.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('does nothing with no tasks or no recipients', async () => {
    expect(await assignDefaults({ tasks: [], clientIds: ['c1'], sessionId: 's1', date: new Date() })).toEqual([])
    expect(await assignDefaults({ tasks, clientIds: [], sessionId: 's1', date: new Date() })).toEqual([])
    expect(h.taskFindMany).not.toHaveBeenCalled()
  })
})

// A SERIES — the homework has to follow the STEP the session covers, not the
// slot it sits in. The moment a step is skipped those are different numbers,
// and the wrong one is wrong silently: the trainer is handed week 3's homework
// for a session that actually covered step 4.
describe('suggestedHomeworkForSession on a series', () => {
  const PLANS = [
    { id: 'p1', sessionIndex: 1, title: 'Recall' },
    { id: 'p2', sessionIndex: 2, title: 'Loose lead' },
    { id: 'p3', sessionIndex: 3, title: 'Stay' },
  ]

  it('follows the CHOSEN step on a 1:1 session, not the session\'s position', async () => {
    // Session 2 of the client's diary, pinned by the trainer to step 3.
    h.sessionFindFirst.mockResolvedValue({
      id: 's2', clientId: 'c1', sessionIndex: null, clientPackageId: 'cp1', classRunId: null,
      classRun: null,
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Puppy Series', isSeries: true, sessionPlans: PLANS } },
    })
    h.sessionFindMany.mockResolvedValue([
      { id: 's1', sessionPlanId: null },
      { id: 's2', sessionPlanId: 'p3' },
    ])
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('s2', 'co1')

    // Its position is 2. Its STEP is 3, and that is what everything keys off.
    expect(out?.sessionIndex).toBe(3)
    expect(out?.stepTitle).toBe('Stay')
    // The homework asked for is step 3's, never position 2's.
    expect(h.defaultFindMany.mock.calls[0][0].where.OR).toEqual([{ sessionIndex: null }, { sessionIndex: 3 }])
  })

  it('drops to the "every session" rows once a 1:1 session runs past the curriculum', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's4', clientId: 'c1', sessionIndex: null, clientPackageId: 'cp1', classRunId: null,
      classRun: null,
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Puppy Series', isSeries: true, sessionPlans: PLANS } },
    })
    h.sessionFindMany.mockResolvedValue([
      { id: 's1', sessionPlanId: null }, { id: 's2', sessionPlanId: null },
      { id: 's3', sessionPlanId: null }, { id: 's4', sessionPlanId: null },
    ])
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('s4', 'co1')

    // No step left, so no numbered homework — not the last step's again.
    expect(out?.sessionIndex).toBeNull()
    expect(out?.stepTitle).toBeNull()
    expect(h.defaultFindMany.mock.calls[0][0].where.OR).toEqual([{ sessionIndex: null }])
  })

  it('numbers a CLASS series by its week and names that step', async () => {
    // A cohort has nothing pinned — week 2 is step 2, for everyone in the room.
    h.sessionFindFirst.mockResolvedValue({
      id: 'cs2', clientId: null, sessionIndex: 2, clientPackageId: null, classRunId: 'r1',
      classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Puppy Class', isSeries: true, sessionPlans: PLANS } },
      clientPackage: null,
    })
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('cs2', 'co1')

    expect(out?.sessionIndex).toBe(2)
    expect(out?.stepTitle).toBe('Loose lead')
    expect(out?.isGroup).toBe(true)
    expect(h.defaultFindMany.mock.calls[0][0].where.OR).toEqual([{ sessionIndex: null }, { sessionIndex: 2 }])
    // A class needs no per-client lookup at all — its step is on the row.
    expect(h.sessionFindMany).not.toHaveBeenCalled()
  })

  it('names no step on a class running past the end of its curriculum', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 'cs5', clientId: null, sessionIndex: 5, clientPackageId: null, classRunId: 'r1',
      classRun: { id: 'r1', packageId: 'p1', package: { id: 'p1', name: 'Puppy Class', isSeries: true, sessionPlans: PLANS } },
      clientPackage: null,
    })
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('cs5', 'co1')

    // Week 5 still asks for week 5's homework — that part is unchanged — but
    // there is no step to name, so nothing is invented.
    expect(out?.sessionIndex).toBe(5)
    expect(out?.stepTitle).toBeNull()
  })

  it('leaves a non-series offering exactly as it was', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's2', clientId: 'c1', sessionIndex: null, clientPackageId: 'cp1', classRunId: null,
      classRun: null,
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Plain 1:1 Session', isSeries: false, sessionPlans: [] } },
    })
    h.sessionFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    h.defaultFindMany.mockResolvedValue([])

    const out = await suggestedHomeworkForSession('s2', 'co1')

    expect(out?.sessionIndex).toBe(2)
    expect(out?.stepTitle).toBeNull()
  })
})
