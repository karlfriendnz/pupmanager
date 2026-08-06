// The flow builder read as a TIMELINE: the three stages a step can sit in, and
// which one a given step belongs to.
//
// Karl: "in automations there should be three steps that you can put automations
// in to - ie. before they confirm, during the session, after the session right?"
// — and, outranking any tidiness: "the idea is the flow — it should be very
// fluid and very flexible."
//
// So these are SCAFFOLDING, not slots:
//
//   • Any step KIND may sit in any stage. Nothing here asks what a step is —
//     only when it happens. A form before the booking and a form after the
//     class are the same kind in different stages, and a trainer who wants a
//     message in the middle of a session may have one.
//   • A stage may hold none, one or ten. An empty stage is rendered quietly,
//     never as a warning or a job to do — most flows use one stage.
//   • A FOURTH stage is a row in the table below plus a branch in
//     `flowStageOf`. It is deliberately not a redesign.
//
// A step's stage is DERIVED, every time, from facts the row already holds
// (`gatesBooking`, `trigger`, `direction`). There is no stage column and there
// must never be one: two places saying when a step happens is how they end up
// disagreeing, which is the same trap the `trigger`/`direction` split was
// written to avoid.
//
// PURE. No Prisma, no React — the builder imports it into the browser bundle.
import { flowAnchorFor, type FlowAnchor } from './flow-anchors'
import type { FlowTrigger } from './comms-flow-steps'

/**
 * The stages, as keys, in the order they happen. The LABELS depend on what the
 * flow hangs off, and no single flow has all five — see FLOW_STAGES_BY_ANCHOR.
 */
export type FlowStageKey =
  | 'BEFORE_CONFIRM'
  | 'ON_ENROLMENT'
  | 'AFTER_SIGNUP'
  | 'DURING_SESSION'
  | 'AFTER_SESSION'
  | 'BEFORE_RENEWAL'

export interface FlowStage {
  key: FlowStageKey
  /** The heading on the spine. */
  label: string
  /** One line under it saying where the boundary is. */
  hint: string
  /** What an empty stage says. Quiet — a stage with nothing in it is normal. */
  empty: string
}

/**
 * The stages each kind of flow actually has.
 *
 * A table rather than a hard-coded triple, because the three stages only mean
 * something where there is a booking and a session to hang them off:
 *
 *   SESSION  — a class or a 1:1. All three: the booking gate, the run-up and
 *              the session itself, and everything afterwards.
 *   PERSON   — an enquiry journey. It runs from "somebody got in touch" to
 *              "you accepted their booking", so the WHOLE of it is the first
 *              stage. Showing it a "During the session" heading that could
 *              never fill would be an invitation to put something nowhere.
 *   PURCHASE — a membership or recurring plan. It has no session at all, so
 *              none of the session stages mean anything — but it has the one
 *              moment Karl asked for by name ("there should also be an 'after
 *              signup' section"): AFTER_PURCHASE, which is somebody joining.
 *              Its other anchor is the run-up to a renewal, so it gets two.
 *
 * ── Joining is a real moment on BOTH, and they are not the same moment ───────
 *
 * A stage must never be offered where the engine cannot fire it, which is why
 * "After signup" was a PURCHASE stage and only a PURCHASE stage: it is fired by
 * `processMembershipStep` counting AFTER_PURCHASE forward from the client's
 * purchase. A class or a 1:1 package had nothing equivalent — the cron scanned
 * SESSIONS, so an AFTER_PURCHASE direction on a class step would be read by that
 * scan as "after the session" and fire after every one of them.
 *
 * So it was given one. `ON_ENROLMENT` is a direction of its own with a pass of
 * its own (`processEnrolmentStep`), anchored on the row that says somebody
 * joined: a ClassEnrollment on a run, a ClientPackage on a 1:1. That is what
 * earns SESSION its own joining stage — and it is a SEPARATE key from
 * AFTER_SIGNUP rather than a second label on it, because the two fire off
 * different columns of different tables and one key would make "which pass runs
 * this" a question you have to answer twice.
 *
 * The WORDS differ because the moments differ. Karl's own — "when they enrol" —
 * for a class or a package, which is a thing you enrol ON. A recurring plan is
 * not enrolled on; it is signed up for, so PURCHASE keeps "After signup".
 */
export const FLOW_STAGES_BY_ANCHOR: Record<FlowAnchor, FlowStage[]> = {
  SESSION: [
    {
      key: 'BEFORE_CONFIRM',
      label: 'Before they confirm',
      hint: 'Part of booking — it holds the booking up until it is done.',
      empty: 'Nothing is asked before they book.',
    },
    {
      key: 'ON_ENROLMENT',
      label: 'When they enrol',
      hint: 'The moment they get a place — a thank-you, or what happens next.',
      empty: 'Nothing welcomes them when they join.',
    },
    {
      key: 'DURING_SESSION',
      label: 'During the session',
      hint: 'From them being booked in, through to the end of the session.',
      empty: 'Nothing happens in the run-up.',
    },
    {
      key: 'AFTER_SESSION',
      label: 'After the session',
      hint: 'Once it is over.',
      empty: 'Nothing follows it up.',
    },
  ],
  PERSON: [
    {
      key: 'BEFORE_CONFIRM',
      label: 'Before they confirm',
      hint: 'Everything somebody goes through before there is a booking.',
      empty: 'Nothing happens yet.',
    },
  ],
  PURCHASE: [
    {
      key: 'AFTER_SIGNUP',
      label: 'After signup',
      hint: 'From the moment somebody joins.',
      empty: 'Nothing happens when somebody joins.',
    },
    {
      key: 'BEFORE_RENEWAL',
      label: 'Before it renews',
      hint: 'The run-up to the end of the period they have paid for.',
      empty: 'Nothing warns them before it renews.',
    },
  ],
}

export function flowStagesFor(anchor: FlowAnchor): FlowStage[] {
  return FLOW_STAGES_BY_ANCHOR[anchor] ?? []
}

/** Everything the stage of a step is derived from. */
export interface StageableStep {
  /** "Ask this before they can confirm the booking" — the first stage, and the
   *  one thing on a step that is not a time at all. */
  gatesBooking?: boolean
  trigger?: FlowTrigger | null
  direction: string
}

/**
 * WHICH stage a step sits in.
 *
 * Read in this order, and the order is the point:
 *
 *   1. A step that gates the booking is in the first stage whatever else it
 *      says. It is answered while somebody is tapping Confirm, so its
 *      direction and offset are inert — reading them first would file a gate
 *      under "1 day before" because that is what the column happened to hold
 *      before the trainer switched the gate on.
 *   2. A person-anchored journey is entirely pre-booking: it ends with the
 *      trainer accepting one. Every step of it is in the first stage.
 *   3. Then the PURCHASE anchors, which are moments in a client's membership
 *      rather than in a session: joining, and the period running out.
 *   4. Then the clock: after the session, during it, or the run-up to it.
 *
 * The run-up (BEFORE_SESSION) lands in "During the session" because the three
 * stages are cut at two moments — the booking being confirmed, and the session
 * ending — and a "see you tomorrow" reminder falls between them. The heading is
 * the bucket; each row still states its own exact timing ("1 day before"), which
 * is what a trainer reads. A separate "Before the session" stage, if Karl wants
 * one, is one entry in the table above and one branch here.
 */
export function flowStageOf(step: StageableStep): FlowStageKey {
  if (step.gatesBooking) return 'BEFORE_CONFIRM'
  if (flowAnchorFor(step) === 'PERSON') return 'BEFORE_CONFIRM'
  if (step.direction === 'ON_ENROLMENT') return 'ON_ENROLMENT'
  if (step.direction === 'AFTER_PURCHASE') return 'AFTER_SIGNUP'
  if (step.direction === 'BEFORE_PERIOD_END') return 'BEFORE_RENEWAL'
  if (step.direction === 'AFTER_SESSION') return 'AFTER_SESSION'
  return 'DURING_SESSION'
}

export interface FlowStageGroup<T> {
  /** Null on a flow with no stages — one plain spine, no heading. */
  stage: FlowStage | null
  steps: T[]
}

/**
 * The spine, cut into its stages.
 *
 * Every stage the anchor HAS comes back, empty ones included: a trainer has to
 * be able to see that nothing follows their class up, and a heading that
 * disappears when it empties is a heading that cannot tell them.
 *
 * Order within a stage is whatever order it was handed in — the caller has
 * already sorted (by the clock, or by the trainer's own arrangement on a
 * journey), and re-sorting here would be a second opinion about the same thing.
 *
 * A step whose stage the anchor does not have goes in the FIRST stage rather
 * than being dropped. Losing a step off the screen it is edited on is the one
 * failure this must not have.
 */
export function groupStepsByStage<T extends StageableStep>(
  steps: T[],
  anchor: FlowAnchor,
): FlowStageGroup<T>[] {
  const stages = flowStagesFor(anchor)
  if (stages.length === 0) return [{ stage: null, steps: [...steps] }]

  const groups: FlowStageGroup<T>[] = stages.map(stage => ({ stage, steps: [] }))
  const byKey = new Map(groups.map(g => [g.stage!.key, g]))
  for (const step of steps) {
    ;(byKey.get(flowStageOf(step)) ?? groups[0]).steps.push(step)
  }
  return groups
}

/**
 * One step moved to where it was dropped, with `order` rewritten to match.
 *
 * Pure, because the drag itself is the easy half — what a reorder has to get
 * right is that a RELOAD shows the same thing (AGENTS.md bug #1), and that is
 * the `order` values, not the array. Stages do not enter into it: the spine is
 * one list and a step dragged across a heading is the same splice as one moved
 * within it.
 *
 * Returns the list unchanged when either id is not in it, so a stale drag
 * cannot renumber a flow.
 */
export function reorderFlowSteps<T extends { id: string; order: number }>(
  list: T[],
  activeId: string,
  overId: string,
): T[] {
  const from = list.findIndex(s => s.id === activeId)
  const to = list.findIndex(s => s.id === overId)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next.map((s, i) => ({ ...s, order: i }))
}
