// Ticking a journey's steps off — from the routes where the thing actually
// happens.
//
// ── Why this module exists ──────────────────────────────────────────────────
//
// `blocking` is the whole of Karl's core case: a client books, is asked to fill
// in a form, and the booking isn't confirmed until they have. `availableSteps`
// already enforces it — nothing past an unfinished blocking step is offered —
// and `advanceFlowRun` already recomputes the cursor from the ledger. What was
// missing until now was anything WRITING to that ledger. Exactly one kind got
// ticked off (ACCOUNT, from the continuation token), so every other kind of
// wall was a wall with no door: phase 3 hid the toggle rather than ship one.
//
// This is the door. Each recorder below is called from the REAL route — the one
// the client's own screen posts to — and never from the UI, because a
// completion written by a browser is a completion anybody can forge, and a
// blocking step is a gate.
//
// ── The rules every recorder here keeps ─────────────────────────────────────
//
//  1. It can only tick off a step that is CURRENTLY OPEN. `availableSteps` is
//     the same call the engine makes, so a step behind an unfinished wall can't
//     be satisfied early by doing something that looks like it.
//  2. It matches on the step's own configuration — the form it names, the
//     homework it hands out, where its upload lands — never on kind alone. Two
//     FORM steps in one journey are two different asks.
//  3. It records against the RUN's user, not the caller. A trainer uploading a
//     photo on a client's behalf still satisfies the ask that was made of that
//     client; the ledger records what happened, not who typed it.
//  4. It is idempotent. The unique (step, run, user) index settles a double-tap,
//     and the conflict is swallowed exactly as CommsFlowSend swallows its own.
//     `advanceFlowRun` derives the cursor rather than incrementing it, so the
//     same completion arriving twice cannot move a run twice.
//  5. It NEVER fails its caller. A journey that fails to advance must not be the
//     reason a photo upload, a form submission or a ticked-off task reports an
//     error to somebody — the same bargain `startEnquiryFlowRun` already keeps.
import { prisma } from './prisma'
import { availableSteps } from './flow-anchors'
import { recordStepCompletion } from './flow-steps'
import { processFlowRun } from './comms-flows'
import { safeFlowStepPayload, taskSpecFor, uploadSpecFor, type FlowStepKind } from './comms-flow-steps'

/** One step of a run that is open right now. */
export interface OpenFlowStep {
  id: string
  kind: FlowStepKind
  payload: unknown
  blocking: boolean
}

/** One run, with the steps it is currently waiting on. */
export interface OpenFlowRun {
  id: string
  userId: string
  clientId: string | null
  trainerId: string
  steps: OpenFlowStep[]
}

/**
 * Which runs to look at. At least one identifier is required — a recorder that
 * scoped to nothing would tick off strangers' journeys.
 */
export interface CompletionScope {
  userId?: string | null
  clientId?: string | null
  /** The business the thing happened in. Belt and braces against a step in one
   *  trainer's journey naming another trainer's form. */
  trainerId?: string | null
}

/**
 * The ACTIVE runs matching a scope, each with the steps it is open on.
 *
 * `availableSteps` is deliberately the same call `processFlowRun` makes, so
 * "what may be ticked off" and "what has been asked" are one answer. A run with
 * no user yet is skipped: nobody has been asked anything, so there is nothing
 * for them to have done.
 */
export async function openFlowRunsFor(scope: CompletionScope): Promise<OpenFlowRun[]> {
  if (!scope.userId && !scope.clientId) return []

  const runs = await prisma.flowRun.findMany({
    where: {
      status: 'ACTIVE',
      ...(scope.userId ? { userId: scope.userId } : {}),
      ...(scope.clientId ? { clientId: scope.clientId } : {}),
      ...(scope.trainerId ? { trainerId: scope.trainerId } : {}),
      NOT: { userId: null },
    },
    select: { id: true, userId: true, clientId: true, trainerId: true, formId: true, packageId: true },
  })

  const open: OpenFlowRun[] = []
  for (const run of runs) {
    if (!run.userId) continue
    const [steps, completions] = await Promise.all([
      prisma.commsFlowStep.findMany({
        where: run.formId ? { formId: run.formId } : { packageId: run.packageId ?? '' },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, order: true, blocking: true, enabled: true, payload: true },
      }),
      prisma.flowStepCompletion.findMany({ where: { runId: run.id }, select: { stepId: true } }),
    ])
    open.push({
      id: run.id,
      userId: run.userId,
      clientId: run.clientId,
      trainerId: run.trainerId,
      steps: availableSteps(steps, completions.map(c => c.stepId)).map(s => ({
        id: s.id,
        kind: s.kind as FlowStepKind,
        payload: s.payload,
        blocking: s.blocking,
      })),
    })
  }
  return open
}

/**
 * Tick off every open step of one kind that this thing answers, and walk each
 * affected run forward.
 *
 * `processFlowRun` is what moves it on: it asks whatever the run is now waiting
 * on and then calls `advanceFlowRun`, which recomputes the cursor from the
 * ledger. Called once per run rather than once per completion, so a journey
 * with two satisfied steps sends one round of notifications, not two.
 */
async function completeOpenSteps(args: {
  scope: CompletionScope
  kind: FlowStepKind
  matches: (step: OpenFlowStep, run: OpenFlowRun) => boolean
  result?: (step: OpenFlowStep, run: OpenFlowRun) => unknown
}): Promise<number> {
  const runs = await openFlowRunsFor(args.scope)
  let recorded = 0
  for (const run of runs) {
    const hits = run.steps.filter(s => s.kind === args.kind && args.matches(s, run))
    if (hits.length === 0) continue
    for (const step of hits) {
      await recordStepCompletion({
        stepId: step.id,
        // The run's own person, not whoever made the request — see rule 3.
        userId: run.userId,
        runId: run.id,
        result: args.result?.(step, run),
      })
      recorded++
    }
    await processFlowRun(run.id)
  }
  return recorded
}

/** Never let a journey be the reason a real action reports failure (rule 5). */
async function quietly(what: string, run: () => Promise<number>): Promise<number> {
  try {
    return await run()
  } catch (err) {
    console.error(`[flow-completions] ${what} failed to record:`, err)
    return 0
  }
}

// ─── FORM ───────────────────────────────────────────────────────────────────

/**
 * They filled in a form. Ticks off any open FORM step that named THAT form.
 *
 * Called from both submit routes, because a journey's form can be answered two
 * ways: the client's own assigned form (`/api/my/intake-form/submit`) and the
 * published enquiry form the flow links them to (`/api/form/[formId]/submit`).
 * The public one only ever records for a SIGNED-IN client — an email address in
 * a public body is not proof of who somebody is, and a blocking form step is a
 * gate somebody would otherwise be able to open on another person's behalf.
 */
export async function completeFormFlowSteps(args: {
  userId?: string | null
  clientId?: string | null
  trainerId?: string | null
  formId: string
  answers?: unknown
}): Promise<number> {
  return quietly('form submission', () =>
    completeOpenSteps({
      scope: { userId: args.userId, clientId: args.clientId, trainerId: args.trainerId },
      kind: 'FORM',
      matches: step => safeFlowStepPayload('FORM', step.payload).payload.formId === args.formId,
      // What they actually did, so a trainer reading the run can see the
      // answers that satisfied the gate rather than just a tick.
      result: () => ({ formId: args.formId, answers: args.answers ?? null }),
    }),
  )
}

// ─── UPLOAD ─────────────────────────────────────────────────────────────────

/**
 * A photo landed on a dog. Ticks off any open UPLOAD step asking for one.
 *
 * The photo itself is written by `/api/dogs/[dogId]/photo` — the route that
 * already stores the blob AND revalidates every screen that draws a dog's
 * picture. This deliberately does not write a second copy of it: the ask and
 * the record are the same act, and a second uploader is a second place for the
 * revalidation to be forgotten.
 *
 * Only DOG_PHOTO steps match, which is the same fact `canWaitForCompletion`
 * gates the toggle on: an ATTACHMENT has no screen of its own to arrive on.
 */
export async function completeDogPhotoFlowSteps(args: {
  userId?: string | null
  clientId?: string | null
  trainerId?: string | null
  dogId: string
  photoUrl: string
}): Promise<number> {
  return quietly('dog photo', () =>
    completeOpenSteps({
      scope: { userId: args.userId, clientId: args.clientId, trainerId: args.trainerId },
      kind: 'UPLOAD',
      matches: step => uploadSpecFor(safeFlowStepPayload('UPLOAD', step.payload).payload).target === 'DOG_PHOTO',
      result: () => ({ dogId: args.dogId, urls: [args.photoUrl] }),
    }),
  )
}

// ─── TASK ───────────────────────────────────────────────────────────────────

/**
 * They ticked their homework off. Ticks off the step that handed it out.
 *
 * Matched the same way `assignFlowTask` de-duplicates: on the library item
 * where there is one, and on the title otherwise. A TrainingTask carries no
 * step id (and phase 4 adds no columns), so this pairing IS the link — and
 * because it is the same key the hand-out uses, a step and the task it created
 * can't disagree about which is which.
 */
export async function completeTaskFlowSteps(args: {
  userId?: string | null
  clientId?: string | null
  trainerId?: string | null
  taskId: string
  title: string
  libraryTaskId: string | null
}): Promise<number> {
  const title = args.title.toLocaleLowerCase('en-NZ')
  return quietly('task completion', () =>
    completeOpenSteps({
      scope: { userId: args.userId, clientId: args.clientId, trainerId: args.trainerId },
      kind: 'TASK',
      matches: step => {
        const spec = taskSpecFor(safeFlowStepPayload('TASK', step.payload).payload)
        if (spec.libraryTaskId) return spec.libraryTaskId === args.libraryTaskId
        // An inline step names its own homework. A step with neither a library
        // item nor a title never handed anything out (flowStepConfigProblem
        // holds it back), so it cannot be what was just ticked off.
        return !!spec.title?.trim() && spec.title.toLocaleLowerCase('en-NZ') === title
      },
      result: () => ({ taskId: args.taskId }),
    }),
  )
}
