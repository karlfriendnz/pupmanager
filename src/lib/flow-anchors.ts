// The PURE half of the flow engine — trigger resolution and sequencing.
//
// Split out of `flow-steps.ts` in phase 3 for one reason: the builder is a
// `'use client'` component and needs to say when a step fires, and
// `flow-steps.ts` imports Prisma. Importing it from the browser bundle would
// pull the database client in behind it. Nothing here touches the database, so
// both sides can share these instead of each keeping its own copy of "what does
// BEFORE_SESSION mean" — which is exactly the drift AGENTS.md keeps warning
// about.
//
// `flow-steps.ts` re-exports every name below, so nothing that already imported
// from there has to change.
import type { FlowStepKind, FlowTrigger } from './comms-flow-steps'

/**
 * WHERE a flow's steps are anchored, which decides who drives them:
 *
 *   SESSION  — a clock relative to a TrainingSession. Driven by the five-minute
 *              cron, statelessly: it scans upcoming sessions, so no per-person
 *              row exists and none should.
 *   PURCHASE — a clock relative to a MembershipPurchase. Same, different anchor.
 *   PERSON   — one person walking through steps in sequence, each unlocked by
 *              COMPLETING the last rather than by a timer. Driven by the app,
 *              never by the cron, and the only anchor that needs a FlowRun.
 */
export type FlowAnchor = 'SESSION' | 'PURCHASE' | 'PERSON'

export const ANCHOR_BY_TRIGGER: Record<FlowTrigger, FlowAnchor> = {
  BEFORE_SESSION: 'SESSION',
  DURING_SESSION: 'SESSION',
  AFTER_SESSION: 'SESSION',
  // SESSION, not an anchor of its own. What "when they enrol" hangs off is the
  // same two owners the other three do — a ClassRun or a 1:1 Package — and the
  // anchor is what decides which stages a flow shows and which step kinds it
  // offers. A fourth value would fork both of those tables to say the same
  // thing twice. The ENGINE still gives it its own pass (processEnrolmentStep):
  // "which flow is this" and "what does the cron scan for it" are two questions,
  // and this one is the first.
  ON_ENROLMENT: 'SESSION',
  AFTER_PURCHASE: 'PURCHASE',
  BEFORE_PERIOD_END: 'PURCHASE',
  ON_ENQUIRY_SUBMITTED: 'PERSON',
  ON_SIGNUP: 'PERSON',
  ON_BOOKING: 'PERSON',
}

/**
 * The trigger a step actually has.
 *
 * `trigger` is null on every row written before flows widened, and stays null
 * on every session/purchase-anchored step for ever: those state their trigger
 * in `direction`, and duplicating it into a second column is how the two drift.
 * This is the ONE place that null is interpreted — read the column raw and you
 * have written the bug.
 */
export function flowTriggerFor(step: { trigger?: FlowTrigger | null; direction: string }): FlowTrigger {
  if (step.trigger) return step.trigger
  // The four CommsFlowDirection values are the first four FlowTrigger values,
  // spelled identically, which is what makes this a lookup and not a mapping
  // table that can rot.
  return (step.direction in ANCHOR_BY_TRIGGER ? step.direction : 'BEFORE_SESSION') as FlowTrigger
}

export function flowAnchorFor(step: { trigger?: FlowTrigger | null; direction: string }): FlowAnchor {
  return ANCHOR_BY_TRIGGER[flowTriggerFor(step)]
}

/**
 * Can a CLOCK fire this kind of step at all?
 *
 * Four of the seven mean something on a timetable: a message, a form due before
 * each class, a photo asked for after one, homework handed out with it. The
 * other three are steps in an acquisition journey — setting a password,
 * choosing what to book, a trainer accepting a time — and a class reminder has
 * no business asking anybody to do those. Firing one off a session would put
 * "choose an offering" in front of somebody already enrolled in it.
 */
export function isClockRunnable(kind: FlowStepKind): boolean {
  switch (kind) {
    case 'MESSAGE':
    case 'FORM':
    case 'UPLOAD':
    case 'TASK':
      return true
    case 'ACCOUNT':
    case 'CHOOSE_OFFERING':
    case 'APPROVAL':
      return false
    default: {
      // A kind added to the enum and not answered for here is a compile error,
      // not a step quietly doing nothing in production.
      const unhandled: never = kind
      void unhandled
      return false
    }
  }
}

/**
 * Does the comms-flow cron act on this step?
 *
 * A clock-anchored step of a kind a clock can fire. A person-anchored one is
 * unlocked by finishing the step before it, so the FlowRun drives it and this
 * scan must leave it alone — firing it here would send a welcome to somebody
 * who never finished signing up.
 */
export function isCronRunnable(step: {
  kind: FlowStepKind
  trigger?: FlowTrigger | null
  direction: string
}): boolean {
  return isClockRunnable(step.kind) && flowAnchorFor(step) !== 'PERSON'
}

/**
 * Does the cron deliver a plain timed MESSAGE for this step?
 *
 * The narrow question — "is this one of the reminders that existed before flows
 * widened" — as opposed to isCronRunnable's "does the cron do anything at all".
 * Kept apart because the two are different questions and reading one as the
 * other is how a FORM step would start sending an empty push.
 */
export function isCronDelivered(step: {
  kind: FlowStepKind
  trigger?: FlowTrigger | null
  direction: string
}): boolean {
  return step.kind === 'MESSAGE' && isCronRunnable(step)
}

/**
 * Can the app tell when somebody has FINISHED a step? Defined next to
 * `uploadSpecFor` in comms-flow-steps.ts, because the answer for an UPLOAD
 * depends on what the step asks for and that default must be read from one
 * place. Re-exported here so every caller that reaches for the anchors gets it
 * from the same door as `availableSteps`, which is the thing it gates.
 */
export { canWaitForCompletion } from './comms-flow-steps'

// ─── Sequencing ─────────────────────────────────────────────────────────────

export interface SequencedStep {
  id: string
  order: number
  blocking: boolean
  enabled: boolean
}

/**
 * Which steps a person can see right now, given what they have finished.
 *
 * A BLOCKING step is a wall: nothing after it is available until it is done.
 * A non-blocking one is a nudge — it stays on the list, but the steps behind it
 * are reachable anyway. That distinction is the whole of Karl's "wait until
 * they've done this before showing the next".
 *
 * Disabled steps are skipped entirely rather than treated as done: a paused
 * step that still blocked the run would strand every person mid-journey the
 * moment a trainer switched it off.
 */
export function availableSteps<T extends SequencedStep>(steps: T[], completedStepIds: Iterable<string>): T[] {
  const done = new Set(completedStepIds)
  const out: T[] = []
  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    if (!step.enabled) continue
    if (done.has(step.id)) continue
    out.push(step)
    if (step.blocking) break
  }
  return out
}

/** The step a run's cursor should sit on — the first unfinished one, or null
 *  when there is nothing left to do. */
export function nextStepFor<T extends SequencedStep>(steps: T[], completedStepIds: Iterable<string>): T | null {
  return availableSteps(steps, completedStepIds)[0] ?? null
}
