// Starting a journey, and walking it forward.
//
// Phase 1 modelled a FlowRun; phase 2 taught the engine to execute a step.
// Nothing created a run. This is the missing half: the moment a public enquiry
// lands on a form that has a flow, that person starts walking it.
//
// ── What Karl asked for ─────────────────────────────────────────────────────
//   contact form → account → password → intake form → choose from offerings
//   → trainer notified → trainer accepts or moves the time
//
// Every one of those is already a step KIND. What was missing was the thing
// that says "this person, on this form, is at step one" — and, crucially, a way
// to generalise the hard-coded three-screen run in `form-continuation.ts`
// WITHOUT taking it away from the forms that use it today.
//
// ── The security boundary is unchanged ──────────────────────────────────────
//
// A journey that includes an ACCOUNT step is still resumed by the SAME
// single-use, 24-hour continuation token minted at submit — see
// `form-continuation.ts` for why that token exists at all: the account step
// never accepts an email address from the browser, it reads it off the enquiry
// the token resolves to, and that is the whole enumeration defence. A second
// resume mechanism would be a second way in, and the weaker of the two would be
// the one that mattered.
//
// So this module deliberately mints NOTHING and stores NO token. It records
// which step somebody is up to; the token is what proves they are them.
import { prisma } from './prisma'
import { processFlowRun } from './comms-flows'
import { recordStepCompletion } from './flow-steps'

/** One step, as much of it as deciding things about a flow needs. */
export interface JourneyStep {
  id: string
  kind: string
  blocking: boolean
  enabled: boolean
  order: number
}

/**
 * The steps a form's journey is made of — enabled ones only, in order.
 *
 * A DISABLED step is not a step: `availableSteps` skips it, so a flow whose
 * only ACCOUNT step is switched off does not ask for an account, and this must
 * agree with that or the two would disagree about whether a form has a journey
 * at all.
 */
export async function formJourneySteps(formId: string): Promise<JourneyStep[]> {
  const steps = await prisma.commsFlowStep.findMany({
    where: { formId, enabled: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, kind: true, blocking: true, enabled: true, order: true },
  })
  return steps as JourneyStep[]
}

/** Does this journey turn the person into a client with a login? */
export function journeyNeedsAccount(steps: JourneyStep[]): boolean {
  return steps.some(s => s.kind === 'ACCOUNT')
}

/**
 * Start a journey for one enquiry — or do nothing at all.
 *
 * Returns null when the form has no flow steps, and that null is the entire
 * compatibility guarantee: a form configured the old way (`continueToAccount`
 * and an intake form, no flow steps) takes exactly the path it took before,
 * writes no FlowRun, and behaves byte for byte as it did. Only a trainer who
 * has actually built a flow gets one.
 *
 * Idempotent per enquiry: a resubmitted request finds the run it already made
 * rather than starting the same person twice.
 */
export async function startEnquiryFlowRun(args: {
  enquiryId: string
  formId: string
  trainerId: string
}): Promise<string | null> {
  const steps = await formJourneySteps(args.formId)
  if (steps.length === 0) return null

  const existing = await prisma.flowRun.findFirst({
    where: { enquiryId: args.enquiryId },
    select: { id: true },
  })
  if (existing) return existing.id

  const run = await prisma.flowRun.create({
    data: {
      trainerId: args.trainerId,
      formId: args.formId,
      trigger: 'ON_ENQUIRY_SUBMITTED',
      enquiryId: args.enquiryId,
      // No userId yet, and that is the point: the enquiry is written before the
      // account exists (see form-continuation.ts on why that order matters).
      // processFlowRun asks nobody it cannot reach, and parks the cursor.
    },
    select: { id: true },
  })

  // Walk it as far as it goes. With no user yet this normally does one useful
  // thing — a TRAINER-actor step reaches the trainer, who exists from the very
  // first moment — and then stops on whatever the person has to do next.
  await processFlowRun(run.id)
  return run.id
}

/**
 * The account step is done: attach the person to their run and carry on.
 *
 * Called after `completeContinuation` has created the User + ClientProfile, and
 * therefore AFTER the continuation token has been spent — which is what proves
 * this is the person the enquiry was about. Nothing here re-checks identity
 * because nothing here is a door: it records a completion for a run that is
 * already tied to that enquiry.
 *
 * Swallows its own errors at the call site, not here — a journey that fails to
 * advance must never be the reason somebody cannot finish signing up.
 */
export async function completeAccountStepForEnquiry(args: {
  enquiryId: string
  clientProfileId: string
}): Promise<{ runId: string; waitingOn: string | null } | null> {
  const run = await prisma.flowRun.findFirst({
    where: { enquiryId: args.enquiryId, status: 'ACTIVE' },
    select: { id: true, formId: true },
  })
  if (!run) return null

  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientProfileId },
    select: { id: true, userId: true },
  })
  if (!client) return null

  // The run now knows who is walking it. Until this point it knew only which
  // enquiry it came from, which is why nothing had been sent to them yet.
  await prisma.flowRun.update({
    where: { id: run.id },
    data: { userId: client.userId, clientId: client.id },
  })

  // Tick off the ACCOUNT step — the first enabled one, since a journey with two
  // "set up a login" steps means the same thing as one. Without this the run
  // would park on it for ever: it is blocking by default, and the completion
  // ledger is the only thing that moves the cursor (advanceFlowRun derives,
  // never increments).
  const account = run.formId
    ? await prisma.commsFlowStep.findFirst({
        where: { formId: run.formId, kind: 'ACCOUNT', enabled: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      })
    : null
  if (account) {
    await recordStepCompletion({ stepId: account.id, userId: client.userId, runId: run.id })
  }

  const { waitingOn } = await processFlowRun(run.id)
  return { runId: run.id, waitingOn }
}
