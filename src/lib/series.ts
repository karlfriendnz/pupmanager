// A SERIES — a CURRICULUM on an offering. Not an offering type of its own.
//
// Each STEP is defined up front on the Package ("session 1 we do recall,
// session 2 loose-lead") and each step carries its homework (PackageDefaultTask,
// keyed off the same 1-based number). Package is the right home for it because
// Package is the template behind BOTH shapes this has to serve — and one editor
// covering both is the same reason PackageDefaultTask already lives there:
//
//   • A GROUP CLASS runs the curriculum as a COHORT. Step N is week N: the
//     class moves through it together, and nobody's week 2 is somebody else's
//     week 3. `stepForIndex` is that rule, and the session already carries the
//     number (TrainingSession.sessionIndex) — nothing per-client is stored.
//
//   • A 1:1 CONSULT runs it per client, and there the order is NOT fixed. The
//     trainer may SKIP a step for a dog that already has it, so a client's
//     second session can be step 3, and everything after it shifts up. That is
//     the whole reason TrainingSession.sessionPlanId exists: on a consult the
//     step is STORED, not counted off the calendar. `resolveSeriesSteps` is
//     that rule. Only the trainer skips; the client never can.
//
// Both answers are the same TYPE — "which step does this session cover" — so
// every caller can ask without caring which shape it has.
//
// Deliberately pure and dependency-free (no prisma, no React) so the API route
// that persists a skip, the session screen that renders it, and the unit tests
// all resolve "which step is this session on" through the SAME code. An earlier
// version of this idea lived as an inline count in two places and disagreed with
// itself the moment anybody skipped anything.

/** One step of the curriculum, as stored on the offering. */
export interface CurriculumStep {
  id: string
  /** 1-based step number. Unique per package (see the schema). */
  sessionIndex: number
  title: string
  description?: string | null
}

/** One of a client's sessions, in the order it sits on the calendar. */
export interface SeriesSession {
  id: string
  /** The step the trainer pinned it to, when they have. */
  sessionPlanId: string | null
}

/** Where one session landed. */
export interface ResolvedStep {
  sessionId: string
  /** The step this session covers — null once the curriculum has run out. */
  step: CurriculumStep | null
  /**
   * The 1-based number the rest of the app keys off: default homework, the
   * "session N of M" label, everything. It is the STEP's number, never the
   * session's position — that difference is the entire feature.
   */
  sessionIndex: number | null
  /** True when the trainer pinned this one by hand rather than it falling out. */
  pinned: boolean
}

/** Curriculum order. The stored `order` is display only; the number is truth. */
export function orderSteps(steps: CurriculumStep[]): CurriculumStep[] {
  return [...steps].sort((a, b) => a.sessionIndex - b.sessionIndex)
}

/**
 * The step covered by session number N — the GROUP CLASS rule, where a cohort
 * moves through the curriculum together and step N is simply week N.
 *
 * A class needs no per-session record because there is nothing to record: the
 * whole class is on the same step, and the session already knows its own number
 * (TrainingSession.sessionIndex). Skipping is a judgement about ONE dog, which
 * is meaningless for a cohort — you cannot skip week 3 for one client without
 * skipping it for everyone sitting in the same room.
 *
 * Returns null past the end of the curriculum, exactly as the consult walk does:
 * a class that runs more weeks than the curriculum has steps simply has weeks
 * with no step, rather than repeating the last one.
 */
export function stepForIndex(
  steps: CurriculumStep[],
  sessionIndex: number | null | undefined,
): CurriculumStep | null {
  if (sessionIndex == null) return null
  return orderSteps(steps).find(s => s.sessionIndex === sessionIndex) ?? null
}

/**
 * Which curriculum step each session covers — the 1:1 CONSULT rule.
 *
 * (A group class uses `stepForIndex` instead: a cohort has nothing to skip, so
 * its step is its week number and no per-session record is kept.)
 *
 * Sessions must arrive in CALENDAR order — the order they will actually happen
 * in — because that is what "the next step" means to a trainer.
 *
 * The walk keeps a cursor into the curriculum:
 *
 *   • A session the trainer PINNED covers that step, and the cursor jumps to
 *     just after it. This is what makes a skip a skip: pin session 2 to step 3
 *     and session 3 falls to step 4, rather than step 3 being covered twice.
 *   • Any other session takes the next step the cursor is pointing at.
 *   • Once the curriculum runs out, later sessions have no step. Extra sessions
 *     beyond the plan are normal — a series can overrun — and they simply carry
 *     no curriculum, rather than being wrongly given the last step again.
 *
 * A pin naming a step that no longer exists (the trainer deleted it) is treated
 * as unpinned, so a curriculum edit can never strand a session on nothing.
 */
export function resolveSeriesSteps(
  steps: CurriculumStep[],
  sessions: SeriesSession[],
): ResolvedStep[] {
  const ordered = orderSteps(steps)
  const positionById = new Map(ordered.map((s, i) => [s.id, i]))

  let cursor = 0
  return sessions.map(session => {
    const pinnedAt = session.sessionPlanId != null ? positionById.get(session.sessionPlanId) : undefined

    if (pinnedAt !== undefined) {
      cursor = pinnedAt + 1
      const step = ordered[pinnedAt]
      return { sessionId: session.id, step, sessionIndex: step.sessionIndex, pinned: true }
    }

    const step = ordered[cursor] ?? null
    if (step) cursor += 1
    return { sessionId: session.id, step, sessionIndex: step?.sessionIndex ?? null, pinned: false }
  })
}

/** The step one session covers, resolved against the whole series. */
export function stepForSession(
  steps: CurriculumStep[],
  sessions: SeriesSession[],
  sessionId: string,
): ResolvedStep | null {
  return resolveSeriesSteps(steps, sessions).find(r => r.sessionId === sessionId) ?? null
}

/**
 * What to WRITE after the trainer moves one session to a different step.
 *
 * A skip is not a fact about one session — it shifts everything after it — so
 * moving session 2 from step 2 to step 3 has to re-point session 3 at step 4,
 * or the series quietly covers step 3 twice and never covers step 4 at all.
 * Rather than leave that as a rule the UI has to remember, the move is resolved
 * through `resolveSeriesSteps` and the whole tail is stamped, so the stored
 * answer and the derived one can never disagree.
 *
 * Returns only the rows that actually change, so an unchanged tail costs nothing.
 * Sessions BEFORE the moved one are untouched: what already happened happened.
 */
export function stampsForStepChange({
  steps,
  sessions,
  sessionId,
  stepId,
}: {
  steps: CurriculumStep[]
  /** Calendar order. */
  sessions: SeriesSession[]
  sessionId: string
  /** The step to move it to, or null to hand it back to the natural order. */
  stepId: string | null
}): { sessionId: string; sessionPlanId: string | null }[] {
  const at = sessions.findIndex(s => s.id === sessionId)
  if (at === -1) return []

  const next = sessions.map((s, i) =>
    i === at ? { ...s, sessionPlanId: stepId } : i > at ? { ...s, sessionPlanId: null } : s,
  )
  const resolved = resolveSeriesSteps(steps, next)

  const changes: { sessionId: string; sessionPlanId: string | null }[] = []
  for (let i = at; i < sessions.length; i++) {
    const want = resolved[i].step?.id ?? null
    if (want !== sessions[i].sessionPlanId) changes.push({ sessionId: sessions[i].id, sessionPlanId: want })
  }
  return changes
}

/**
 * The steps to offer when the trainer changes which one a session covers.
 *
 * Every step, always — including ones already covered. A trainer repeating a
 * step for a dog that didn't get it is as real as skipping one, and a picker
 * that hid covered steps would make that impossible.
 */
export function stepOptions(steps: CurriculumStep[]): CurriculumStep[] {
  return orderSteps(steps)
}

/** "Step 2 · Loose-lead walking" — one label, so the screens don't each invent one. */
export function stepLabel(step: CurriculumStep): string {
  return `Step ${step.sessionIndex} · ${step.title}`
}

/** One client's place in a series, as the 1:1 session roster reads it. */
export interface SeriesProgress {
  /** The step they are UP TO — the one their next unfinished session covers. */
  step: CurriculumStep | null
  /** Steps already covered by sessions that have happened. */
  done: number
  /** Steps in the curriculum. `done` is out of this. */
  total: number
  /** When the step they're up to happens. Null once nothing is left booked. */
  nextAt: Date | null
  /** Every step covered by a session that has happened. */
  finished: boolean
}

/**
 * Where one client has got to on a consult series — "Sam, step 3 of 6, Tuesday".
 *
 * A consult series has no cohort: clients join individually and each one is at
 * their own point, which is exactly the thing a class page can show at a glance
 * and a consult page could not. So it is answered per ClientPackage, from that
 * client's own sessions.
 *
 * "Up to" is the first session still to happen, not the count of sessions —
 * with a skip those are different numbers, and the count is the one that lies.
 * `done` is likewise counted from sessions that ACTUALLY happened, so a client
 * with four sessions booked and one attended reads step 2 of 6, not 5 of 6.
 */
export function seriesProgress(
  steps: CurriculumStep[],
  /** The client's sessions in CALENDAR order. */
  sessions: (SeriesSession & { done: boolean; at?: Date | string | null })[],
): SeriesProgress {
  const resolved = resolveSeriesSteps(steps, sessions)
  const total = steps.length

  // Distinct steps, so two sessions pinned to the same step (a repeat, which is
  // allowed on purpose) don't count as two steps covered.
  const covered = new Set<string>()
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].done && resolved[i].step) covered.add(resolved[i].step!.id)
  }

  const nextAt = sessions.findIndex(s => !s.done)
  if (nextAt === -1) {
    return { step: null, done: covered.size, total, nextAt: null, finished: true }
  }
  const at = sessions[nextAt].at
  return {
    step: resolved[nextAt].step,
    done: covered.size,
    total,
    nextAt: at ? new Date(at) : null,
    finished: false,
  }
}
