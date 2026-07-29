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
      clientPackage: { id: 'cp1', package: { id: 'p1', name: 'Puppy Consult' } },
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
    { id: 'd1', libraryTaskId: 'L1', title: 'Loose lead', description: 'walk nicely', repetitions: 5, videoUrl: null, order: 0 },
    { id: 'd2', libraryTaskId: null, title: 'Crate rest', description: null, repetitions: null, videoUrl: null, order: 1 },
  ]

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
