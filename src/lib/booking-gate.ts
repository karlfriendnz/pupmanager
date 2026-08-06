// A form that genuinely holds up a booking.
//
// ── What this is for ────────────────────────────────────────────────────────
//
// Karl's groomer: "for every groom in a 1:1 package i ask the client the same
// questions before they confirm the booking." Five questions, every groom, and
// the booking is not confirmed until they are answered.
//
// Until now a FORM step in a flow was a NUDGE. The run waited on it and the
// client was chased, but the TrainingSession was created the moment they tapped
// Book. A trainer who set one up got a client who was booked in AND being
// nagged. This module is the difference between that and a gate.
//
// ── Where the gate is configured ────────────────────────────────────────────
//
// On the OFFERING, in the same flow editor as everything else, because Karl
// thinks of automations in three stages — before they confirm, during the
// session, after the session. `direction` + `offsetMinutes` say the last two.
// This is the first, and it is not a time at all, which is why it is its own
// column (`CommsFlowStep.gatesBooking`) rather than another direction.
//
// A FORM step with `gatesBooking` on, sitting on a Package (a 1:1) or a
// ClassRun (a class/event), turns the gate on for that offering. Nothing else
// does.
//
// ── The one rule that makes it repeat ───────────────────────────────────────
//
// The gate is satisfied by ANSWERS SUPPLIED WITH THIS BOOKING, and by nothing
// else. There is deliberately no query anywhere that asks "has this client
// answered this form before" — that question is how the fifth groom would sail
// through on the first groom's answers, when asking again every time is the
// entire point ("the next session it does the same thing").
//
// What gets written afterwards (BookingFormAnswer) is a RECORD, keyed to the
// session / enrolment / request it belongs to. It is never read back as
// permission.
//
// ── A broken gate is not a gate ─────────────────────────────────────────────
//
// A FORM step with no form chosen resolves to `null` here — no gate — exactly
// as `flowStepConfigProblem` already treats it ("Until that's set, this step is
// skipped"), and the flow editor warns the trainer in amber while they are
// still looking at it. The alternative is an offering nobody can book because
// of a half-finished step, which is a worse failure than one that doesn't ask.
import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma'
import { missingRequiredQuestions, type FormStep, type Question } from './session-form-builder'
import { safeFlowStepPayload } from './comms-flow-steps'

type Db = Pick<typeof prisma, 'commsFlowStep' | 'form'>

/**
 * How long a slot is held while they answer.
 *
 * SHORT on purpose. The form is step 3 of the booking wizard, not a screen they
 * are sent away to, so the gap between picking 2pm and confirming is however
 * long it takes to type five answers. Long enough to think, short enough that a
 * distracted person doesn't take the hour out of the diary.
 */
export const BOOKING_HOLD_MINUTES = 8

/**
 * How long it is held once a card is involved.
 *
 * A Stripe checkout is a round trip to another site, sometimes via a banking
 * app and a 2FA code, and it finishes on a WEBHOOK rather than on the client
 * coming back. Holding for the form's eight minutes would routinely drop the
 * slot while the money was in flight — which is the one case where losing it
 * costs somebody real money. Extended once, at checkout, and never again.
 */
export const BOOKING_HOLD_PAYMENT_MINUTES = 30

/** The offering a gate is being looked up for. Exactly one is set. */
export interface GateScope {
  packageId?: string | null
  classRunId?: string | null
}

/** A resolved gate: the step that demands it and the form it demands. */
export interface BookingGate {
  stepId: string
  formId: string
  form: {
    id: string
    trainerId: string
    name: string
    description: string | null
    questions: Question[]
    steps: FormStep[]
  }
}

/**
 * The gating FORM step for an offering, or null when it has none.
 *
 * For a class the run's OWN step wins, and the offering's applies when the run
 * has not overridden it — a trainer who sets the questions on the offering means
 * them for every run of it, and one who sets them on a single run means them for
 * that run. For a 1:1 there is only the package.
 *
 * `enabled` is honoured here, so switching the step off in the flow editor takes
 * the gate down with it: what disappears from the screen disappears from the
 * booking.
 */
export async function bookingGateFor(scope: GateScope, db: Db = prisma): Promise<BookingGate | null> {
  const wheres: Prisma.CommsFlowStepWhereInput[] = []
  if (scope.classRunId) wheres.push({ classRunId: scope.classRunId })
  if (scope.packageId) wheres.push({ packageId: scope.packageId })
  if (wheres.length === 0) return null

  for (const where of wheres) {
    const step = await db.commsFlowStep.findFirst({
      where: { ...where, kind: 'FORM', gatesBooking: true, enabled: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, payload: true },
    })
    if (!step) continue

    const formId = safeFlowStepPayload('FORM', step.payload).payload.formId
    // A step that names no form asks nothing — see the header. Keep looking: a
    // run with a half-built step should still honour the offering's finished one.
    if (!formId) continue

    const form = await db.form.findUnique({
      where: { id: formId },
      select: { id: true, trainerId: true, name: true, description: true, questions: true, steps: true, isActive: true },
    })
    // A deleted or drafted form is the same situation as an unnamed one.
    if (!form || !form.isActive) continue

    const questions = (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[]
    // A form with no questions can only ever be satisfied, so gating on it would
    // add a step to the wizard that says nothing and costs a tap.
    if (questions.length === 0) continue

    return {
      stepId: step.id,
      formId: form.id,
      form: {
        id: form.id,
        trainerId: form.trainerId,
        name: form.name,
        description: form.description,
        questions,
        steps: (Array.isArray(form.steps) ? form.steps : []) as unknown as FormStep[],
      },
    }
  }
  return null
}

/** What a client sent back. Question id → answer, exactly as FormRunner emits. */
export type GateAnswers = Record<string, string | string[]>

/** Why a booking may not go ahead. `null` means the gate is satisfied. */
export interface GateRefusal {
  code: 'FORM_REQUIRED'
  error: string
  formId: string
  /** Question ids that were required and left blank, for the runner to flag. */
  missing: string[]
}

/**
 * The server's half of the gate — the ONLY half that counts.
 *
 * The wizard will not let anybody past its form step, and that is worth having;
 * it is not enforcement. A crafted POST does not come from the wizard, and this
 * codebase has already shipped exactly this bug once: `required` lived only in
 * FormRunner, so an empty intake stamped itself complete and lifted the gate
 * (AGENTS.md bug #3). `missingRequiredQuestions` exists for this case and
 * applies the same visibility rules the browser does, so a required question
 * hidden by its own `showIf` can never block a booking nobody could answer.
 *
 * Pure — no database, no clock — so it is cheap to test every branch of.
 */
export function gateRefusal(
  gate: BookingGate | null,
  answers: GateAnswers | null | undefined,
): GateRefusal | null {
  if (!gate) return null
  const given = answers ?? {}
  const missing = missingRequiredQuestions(gate.form.questions, given)
  // No answers at all is the crafted-request case, and it is also what an
  // offering whose form is entirely optional looks like. Both are handled by the
  // same check: what matters is whether anything REQUIRED is unanswered.
  if (missing.length === 0) return null
  return {
    code: 'FORM_REQUIRED',
    error: `Please answer ${gate.form.name} before booking.`,
    formId: gate.formId,
    missing: missing.map(q => q.id),
  }
}

/**
 * Drop anything that isn't a question on this form.
 *
 * A booking body is client-supplied, and storing whatever keys it happened to
 * carry would let anybody grow the row without limit and would put junk in front
 * of the trainer reading the answers back.
 */
export function pickGateAnswers(gate: BookingGate, answers: GateAnswers | null | undefined): GateAnswers {
  const ids = new Set(gate.form.questions.map(q => q.id))
  const out: GateAnswers = {}
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (ids.has(k)) out[k] = v
  }
  return out
}

/** Where one answer set belongs. Exactly one is set — see BookingFormAnswer. */
export interface AnswerAnchor {
  sessionId?: string | null
  enrollmentId?: string | null
  bookingRequestId?: string | null
}

type AnswerWriter = Pick<Prisma.TransactionClient, 'bookingFormAnswer'>

/**
 * Record what was said to get through the gate.
 *
 * Against the SESSION (or enrolment, or the request that is still waiting for a
 * trainer), never against the client — see the header. Idempotent on the unique
 * (anchor, form) index, because a webhook can be delivered twice and a retried
 * booking must not fail on a duplicate.
 *
 * Never throws. A booking that has already happened must not be reported as
 * failed because the paperwork behind it didn't write — the same bargain
 * lib/flow-completions keeps.
 */
export async function recordBookingAnswers(
  db: AnswerWriter,
  args: {
    trainerId: string
    clientId: string
    formId: string
    stepId?: string | null
    answers: GateAnswers
    anchor: AnswerAnchor
  },
): Promise<void> {
  try {
    await db.bookingFormAnswer.create({
      data: {
        trainerId: args.trainerId,
        clientId: args.clientId,
        formId: args.formId,
        stepId: args.stepId ?? null,
        sessionId: args.anchor.sessionId ?? null,
        enrollmentId: args.anchor.enrollmentId ?? null,
        bookingRequestId: args.anchor.bookingRequestId ?? null,
        answers: args.answers as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    // P2002 is the double-delivery case and is exactly what the index is for.
    const code = (err as { code?: string })?.code
    if (code !== 'P2002') {
      console.error('[booking-gate] could not record answers', args.anchor, err)
    }
  }
}

/**
 * Move a request's answers onto the sessions the trainer's approval created.
 *
 * An approval-required offering asks its questions BEFORE anybody has said yes,
 * so the answers are parked on the BookingRequest. Confirming it creates the
 * real sessions, and without this the answers would sit on a decided request
 * while the session the trainer is about to run has none — the client typed
 * them and they went nowhere, which is bug #8's shape all over again.
 */
export async function carryRequestAnswersToSession(
  db: Pick<Prisma.TransactionClient, 'bookingFormAnswer'>,
  args: { bookingRequestId: string; sessionId: string | null },
): Promise<void> {
  if (!args.sessionId) return
  try {
    const rows = await db.bookingFormAnswer.findMany({
      where: { bookingRequestId: args.bookingRequestId },
      select: { id: true },
    })
    for (const row of rows) {
      await db.bookingFormAnswer.update({
        where: { id: row.id },
        // The request stays as the provenance; the session is what the trainer
        // now reads it from.
        data: { sessionId: args.sessionId },
      })
    }
  } catch (err) {
    console.error('[booking-gate] could not carry request answers to session', args.bookingRequestId, err)
  }
}

/**
 * Has this session/enrolment already had its gating form answered?
 *
 * Used ONLY to stop the flow's own FORM step nagging somebody who answered it
 * at the moment they booked. It is not, and must never become, the gate: see
 * the header on why "they've answered before" cannot be permission.
 */
export async function bookingAnswerExists(
  anchor: AnswerAnchor & { formId: string },
  db: Pick<typeof prisma, 'bookingFormAnswer'> = prisma,
): Promise<boolean> {
  if (!anchor.sessionId && !anchor.enrollmentId) return false
  const row = await db.bookingFormAnswer.findFirst({
    where: {
      formId: anchor.formId,
      ...(anchor.sessionId ? { sessionId: anchor.sessionId } : {}),
      ...(anchor.enrollmentId ? { enrollmentId: anchor.enrollmentId } : {}),
    },
    select: { id: true },
  })
  return !!row
}
