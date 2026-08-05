// The flow ENGINE's database half — the completion ledger and the run cursor.
//
// `comms-flow-steps.ts` validates what a trainer types; `comms-flows.ts` sends
// the timed messages; `flow-anchors.ts` holds the PURE parts (trigger
// resolution and sequencing), which the builder needs in the browser and which
// therefore cannot live in a module that imports Prisma.
//
// Everything in `flow-anchors.ts` is re-exported here, so every caller that
// already reached for `@/lib/flow-steps` keeps working — there is one
// definition of `flowTriggerFor`, in one place, with two doors on to it.
import { prisma } from './prisma'
import { nextStepFor } from './flow-anchors'
import type { FlowStepKind, FlowTrigger } from './comms-flow-steps'

export type { FlowStepKind, FlowTrigger }
export type { FlowAnchor, SequencedStep } from './flow-anchors'
export {
  ANCHOR_BY_TRIGGER,
  flowTriggerFor,
  flowAnchorFor,
  isClockRunnable,
  isCronRunnable,
  isCronDelivered,
  availableSteps,
  nextStepFor,
} from './flow-anchors'

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
