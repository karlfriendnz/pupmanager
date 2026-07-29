import { describe, it, expect } from 'vitest'
import {
  resolveSeriesSteps,
  stepForIndex,
  stampsForStepChange,
  seriesProgress,
  stepOptions,
  stepLabel,
  type CurriculumStep,
} from '@/lib/series'

// A SERIES — a curriculum on an offering, served two ways.
//
// These cover the one thing that can go wrong silently: the step a session
// covers drifting away from the step its homework, its plan and its label are
// taken from. The two shapes get there differently — a class counts weeks, a
// consult remembers what the trainer pinned — so both are exercised here.

const CURRICULUM: CurriculumStep[] = [
  { id: 'p1', sessionIndex: 1, title: 'Recall' },
  { id: 'p2', sessionIndex: 2, title: 'Loose lead' },
  { id: 'p3', sessionIndex: 3, title: 'Stay' },
  { id: 'p4', sessionIndex: 4, title: 'Door manners' },
]

/** N sessions in calendar order, none pinned. */
const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, sessionPlanId: null as string | null }))

describe('a 1:1 session series — the step is stored, not counted', () => {
  it('runs the curriculum in order when nothing is skipped', () => {
    const out = resolveSeriesSteps(CURRICULUM, sessions(4))
    expect(out.map(r => r.sessionIndex)).toEqual([1, 2, 3, 4])
    expect(out.every(r => !r.pinned)).toBe(true)
  })

  it('SKIPPING a step means the next session covers the step AFTER it', () => {
    // The trainer moves session 2 onto step 3 — this dog already has loose lead.
    const rows = [
      { id: 's1', sessionPlanId: null },
      { id: 's2', sessionPlanId: 'p3' },
      { id: 's3', sessionPlanId: null },
      { id: 's4', sessionPlanId: null },
    ]
    const out = resolveSeriesSteps(CURRICULUM, rows)

    expect(out.map(r => r.sessionIndex)).toEqual([1, 3, 4, null])
    // Step 3 is covered once, by session 2 — not again by session 3, which is
    // the bug a count-off-the-calendar version would reintroduce.
    expect(out.filter(r => r.step?.id === 'p3')).toHaveLength(1)
    // Step 2 is skipped: nobody covers it.
    expect(out.some(r => r.step?.id === 'p2')).toBe(false)
    // The 4th session runs past the end rather than repeating step 4.
    expect(out[3].step).toBeNull()
  })

  it('a skip re-stamps the whole tail, so nothing is covered twice', () => {
    const rows = sessions(4)
    const changes = stampsForStepChange({
      steps: CURRICULUM,
      sessions: rows,
      sessionId: 's2',
      stepId: 'p3',
    })

    // Session 2 → step 3, and session 3 has to move to step 4 with it.
    // Session 4 runs off the end of the curriculum and was already unpinned,
    // so it is not in the list at all: only rows that actually change are
    // written, and an unchanged tail costs nothing.
    expect(changes).toEqual([
      { sessionId: 's2', sessionPlanId: 'p3' },
      { sessionId: 's3', sessionPlanId: 'p4' },
    ])
    // Session 1 already happened — it is never touched.
    expect(changes.some(c => c.sessionId === 's1')).toBe(false)
  })

  it('hands a session back to the natural order when the pin is cleared', () => {
    const rows = [
      { id: 's1', sessionPlanId: 'p1' },
      { id: 's2', sessionPlanId: 'p3' },
      { id: 's3', sessionPlanId: 'p4' },
    ]
    const changes = stampsForStepChange({ steps: CURRICULUM, sessions: rows, sessionId: 's2', stepId: null })
    expect(changes).toEqual([
      { sessionId: 's2', sessionPlanId: 'p2' },
      { sessionId: 's3', sessionPlanId: 'p3' },
    ])
  })

  it('treats a pin at a deleted step as unpinned rather than stranding it', () => {
    const rows = [
      { id: 's1', sessionPlanId: null },
      { id: 's2', sessionPlanId: 'gone' },
    ]
    const out = resolveSeriesSteps(CURRICULUM, rows)
    expect(out.map(r => r.sessionIndex)).toEqual([1, 2])
  })

  it('offers every step to move to, including ones already covered', () => {
    // Repeating a step for a dog that didn't get it is as real as skipping one.
    expect(stepOptions(CURRICULUM).map(s => s.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})

describe('a class series — step N is week N', () => {
  it('numbers steps by the session number the cohort is on', () => {
    expect(stepForIndex(CURRICULUM, 1)?.title).toBe('Recall')
    expect(stepForIndex(CURRICULUM, 3)?.title).toBe('Stay')
  })

  it('has no step past the end of the curriculum, rather than repeating the last', () => {
    // A 6-week run of a 4-step curriculum: weeks 5 and 6 carry no step.
    expect(stepForIndex(CURRICULUM, 5)).toBeNull()
    expect(stepForIndex(CURRICULUM, 6)).toBeNull()
  })

  it('has no step for a session with no number', () => {
    expect(stepForIndex(CURRICULUM, null)).toBeNull()
    expect(stepForIndex(CURRICULUM, undefined)).toBeNull()
  })

  it('does not shift when the curriculum is stored out of order', () => {
    const jumbled = [CURRICULUM[2], CURRICULUM[0], CURRICULUM[3], CURRICULUM[1]]
    expect(stepForIndex(jumbled, 2)?.title).toBe('Loose lead')
  })

  it('gives every client in the cohort the same step for the same week', () => {
    // The point of the class rule: nothing is per-client, so two clients on
    // week 3 are on step 3 — there is no sessionPlanId to disagree about.
    expect(stepForIndex(CURRICULUM, 3)).toBe(stepForIndex(CURRICULUM, 3))
  })
})

describe('where one client is up to (1:1 session roster)', () => {
  const at = (d: string) => new Date(`2026-08-${d}T10:00:00Z`)

  it('reports the step their next session covers, not how many they have had', () => {
    // Two done, and step 2 was skipped — so they are UP TO step 4 on their
    // third session. Counting sessions would say step 3.
    const rows = [
      { id: 's1', sessionPlanId: 'p1', done: true, at: at('03') },
      { id: 's2', sessionPlanId: 'p3', done: true, at: at('10') },
      { id: 's3', sessionPlanId: null, done: false, at: at('17') },
    ]
    const p = seriesProgress(CURRICULUM, rows)

    expect(p.step?.sessionIndex).toBe(4)
    expect(p.step?.title).toBe('Door manners')
    expect(p.done).toBe(2)
    expect(p.total).toBe(4)
    expect(p.nextAt?.toISOString()).toBe(at('17').toISOString())
    expect(p.finished).toBe(false)
  })

  it('counts a repeated step once', () => {
    const rows = [
      { id: 's1', sessionPlanId: 'p1', done: true, at: at('03') },
      { id: 's2', sessionPlanId: 'p1', done: true, at: at('10') },
      { id: 's3', sessionPlanId: null, done: false, at: at('17') },
    ]
    expect(seriesProgress(CURRICULUM, rows).done).toBe(1)
  })

  it('says finished once every session has happened', () => {
    const rows = [
      { id: 's1', sessionPlanId: null, done: true, at: at('03') },
      { id: 's2', sessionPlanId: null, done: true, at: at('10') },
    ]
    const p = seriesProgress(CURRICULUM, rows)
    expect(p.finished).toBe(true)
    expect(p.step).toBeNull()
    expect(p.nextAt).toBeNull()
    expect(p.done).toBe(2)
  })

  it('has no step left once they run past the end of the curriculum', () => {
    const rows = [
      ...[1, 2, 3, 4].map(i => ({ id: `s${i}`, sessionPlanId: null, done: true, at: at('0' + i) })),
      { id: 's5', sessionPlanId: null, done: false, at: at('20') },
    ]
    const p = seriesProgress(CURRICULUM, rows)
    expect(p.step).toBeNull()
    expect(p.done).toBe(4)
    // Still has a session booked, so it is not "finished" — just off the plan.
    expect(p.finished).toBe(false)
  })
})

describe('stepLabel', () => {
  it('names a step the same way everywhere', () => {
    expect(stepLabel(CURRICULUM[1])).toBe('Step 2 · Loose lead')
  })
})
