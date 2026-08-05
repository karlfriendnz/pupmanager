// The flow ENGINE's primitives — the parts that are about a flow rather than
// about a message.
//
// `comms-flow-steps.ts` validates what a trainer types; `comms-flows.ts` sends
// the timed messages. This file holds the three things that only make sense
// once a flow can be more than a set of reminders:
//
//   1. resolving a step's trigger, and from it which ANCHOR the step uses;
//   2. sequencing — which step a person is up to, and what `blocking` means;
//   3. the completion ledger — "they did it", the mirror of CommsFlowSend's
//      "we sent it".
//
// Nothing writes a completion in phase 1 except the tests. That is deliberate:
// this is the seam phases 2–5 hang off, and it lands with the schema so the
// later work is additive rather than another migration.
import { prisma } from './prisma'
import type { FlowStepKind, FlowTrigger } from './comms-flow-steps'

export type { FlowStepKind, FlowTrigger }

/**
 * WHERE a flow's steps are anchored, which decides who drives them:
 *
 *   SESSION  — a clock relative to a TrainingSession. Driven by the five-minute
 *              cron, statelessly: it scans upcoming sessions, so no per-person
 *              row exists and none should. Everything shipped today is this.
 *   PURCHASE — a clock relative to a MembershipPurchase. Same, different anchor.
 *   PERSON   — one person walking through steps in sequence, each unlocked by
 *              COMPLETING the last rather than by a timer. Driven by the app,
 *              never by the cron, and the only anchor that needs a FlowRun.
 */
export type FlowAnchor = 'SESSION' | 'PURCHASE' | 'PERSON'

const ANCHOR_BY_TRIGGER: Record<FlowTrigger, FlowAnchor> = {
  BEFORE_SESSION: 'SESSION',
  AFTER_SESSION: 'SESSION',
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
 * Does the comms-flow cron deliver this step?
 *
 * Only a MESSAGE step on a clock. Every other kind is something a PERSON does —
 * the cron has nothing to push and nothing to wait for, so its correct
 * behaviour for them is to do nothing, cleanly and without a log line.
 */
export function isCronDelivered(step: {
  kind: FlowStepKind
  trigger?: FlowTrigger | null
  direction: string
}): boolean {
  return step.kind === 'MESSAGE' && flowAnchorFor(step) !== 'PERSON'
}

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

// ─── The completion ledger ──────────────────────────────────────────────────

/** Exactly one of these is set, matching how the step is anchored. */
export interface CompletionAnchor {
  runId?: string | null
  sessionId?: string | null
  purchaseId?: string | null
}

function anchorWhere(anchor: CompletionAnchor) {
  return {
    runId: anchor.runId ?? null,
    sessionId: anchor.sessionId ?? null,
    purchaseId: anchor.purchaseId ?? null,
  }
}

/**
 * Record that one person finished one step.
 *
 * Idempotent by the unique index on (step, anchor, user) — exactly the idiom
 * CommsFlowSend uses, and for the same reason: a double-tapped button and two
 * overlapping ticks both land here, and the database is the only thing that can
 * settle which one wins. The conflict is swallowed, not raised: the caller
 * asked for the row to exist, and it does.
 */
export async function recordStepCompletion(args: {
  stepId: string
  userId: string
  result?: unknown
} & CompletionAnchor): Promise<void> {
  const { stepId, userId, result, ...anchor } = args
  await prisma.flowStepCompletion
    .create({
      data: {
        stepId,
        userId,
        ...anchorWhere(anchor),
        // Prisma refuses `undefined` differently from `null` on a Json column;
        // "no result" is genuinely null, not absent.
        result: result === undefined ? undefined : (result as never),
      },
    })
    .catch(() => {})
}

/** Has this person already finished this step against this anchor? */
export async function isStepCompleteFor(
  args: { stepId: string; userId: string } & CompletionAnchor,
): Promise<boolean> {
  const { stepId, userId, ...anchor } = args
  // findFirst, not findUnique: the anchors are nullable, and Postgres treats
  // NULL as distinct from NULL in a unique index — so the compound key is not
  // addressable when two of its three columns are null.
  const row = await prisma.flowStepCompletion.findFirst({
    where: { stepId, userId, ...anchorWhere(anchor) },
    select: { id: true },
  })
  return !!row
}

/** Every step id this person has finished against one anchor. */
export async function completedStepIdsFor(
  args: { userId: string } & CompletionAnchor,
): Promise<string[]> {
  const { userId, ...anchor } = args
  const rows = await prisma.flowStepCompletion.findMany({
    where: { userId, ...anchorWhere(anchor) },
    select: { stepId: true },
  })
  return rows.map(r => r.stepId)
}

/**
 * Move a run's cursor to wherever its completions say it should be, and close
 * it when there is nothing left.
 *
 * Derived, never incremented: a cursor that is written forward one step at a
 * time drifts the first time a step is added, disabled or deleted underneath a
 * half-finished run — and a person stuck on a step that no longer exists has no
 * way out. Recomputing from the ledger cannot get stuck.
 */
export async function advanceFlowRun(runId: string): Promise<{ currentStepId: string | null; completed: boolean }> {
  const run = await prisma.flowRun.findUnique({
    where: { id: runId },
    select: { id: true, formId: true, packageId: true, userId: true, status: true },
  })
  if (!run) return { currentStepId: null, completed: false }

  const [steps, completions] = await Promise.all([
    prisma.commsFlowStep.findMany({
      where: run.formId ? { formId: run.formId } : { packageId: run.packageId ?? '' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, order: true, blocking: true, enabled: true },
    }),
    prisma.flowStepCompletion.findMany({ where: { runId }, select: { stepId: true } }),
  ])

  const next = nextStepFor(steps, completions.map(c => c.stepId))
  const completed = next === null
  await prisma.flowRun.update({
    where: { id: runId },
    data: {
      currentStepId: next?.id ?? null,
      status: completed ? 'COMPLETED' : 'ACTIVE',
      completedAt: completed ? new Date() : null,
    },
  })
  return { currentStepId: next?.id ?? null, completed }
}
