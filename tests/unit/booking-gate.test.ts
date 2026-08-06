import { describe, it, expect, vi, beforeEach } from 'vitest'

// The booking gate: a FORM step on an offering that holds the booking up until
// it is answered.
//
// The tests that matter most here are the NEGATIVE ones — the shapes of "gate
// that isn't really a gate" this codebase is prone to. A required question
// enforced only in the browser (bug #3) and a permission derived from history
// rather than from the request are both one careless line away.
const h = vi.hoisted(() => ({
  stepFindFirst: vi.fn(),
  formFindUnique: vi.fn(),
  answerCreate: vi.fn(),
  answerFindFirst: vi.fn(),
  answerFindMany: vi.fn(),
  answerUpdate: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    commsFlowStep: { findFirst: h.stepFindFirst },
    form: { findUnique: h.formFindUnique },
    bookingFormAnswer: {
      create: h.answerCreate,
      findFirst: h.answerFindFirst,
      findMany: h.answerFindMany,
      update: h.answerUpdate,
    },
  },
}))

import {
  bookingGateFor,
  gateRefusal,
  pickGateAnswers,
  recordBookingAnswers,
  bookingAnswerExists,
  carryRequestAnswersToSession,
  BOOKING_HOLD_MINUTES,
  BOOKING_HOLD_PAYMENT_MINUTES,
  type BookingGate,
} from '@/lib/booking-gate'

const PKG = 'pkg_groom'
const RUN = 'run_puppy'
const FORM = 'form_pregroom'
const TRAINER = 'tr_1'

const QUESTIONS = [
  { id: 'q1', type: 'TEXT', label: 'Any new bites or sore spots?', required: true },
  { id: 'q2', type: 'TEXT', label: 'Anything else?', required: false },
  // Only asked when they said yes to q1 — a required question that is invisible
  // must never block a booking nobody could have answered.
  { id: 'q3', type: 'TEXT', label: 'Where?', required: true, showIf: { questionId: 'q1', equals: 'yes' } },
]

const formRow = (over: Record<string, unknown> = {}) => ({
  id: FORM,
  trainerId: TRAINER,
  name: 'Pre-groom questions',
  description: null,
  questions: QUESTIONS,
  steps: [],
  isActive: true,
  ...over,
})

const gate = (): BookingGate => ({
  stepId: 'step_1',
  formId: FORM,
  form: {
    id: FORM,
    trainerId: TRAINER,
    name: 'Pre-groom questions',
    description: null,
    questions: QUESTIONS as never,
    steps: [],
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.stepFindFirst.mockResolvedValue(null)
  h.formFindUnique.mockResolvedValue(formRow())
  h.answerCreate.mockResolvedValue({ id: 'bfa_1' })
  h.answerFindFirst.mockResolvedValue(null)
  h.answerFindMany.mockResolvedValue([])
  h.answerUpdate.mockResolvedValue({})
})

describe('the hold windows', () => {
  // The form is a STEP of the wizard, so the limbo is however long five answers
  // take. A card is a round trip to another site that finishes on a webhook.
  it('are short for a form and longer for a card', () => {
    expect(BOOKING_HOLD_MINUTES).toBeLessThanOrEqual(10)
    expect(BOOKING_HOLD_PAYMENT_MINUTES).toBeGreaterThan(BOOKING_HOLD_MINUTES)
  })
})

describe('bookingGateFor', () => {
  it('finds the FORM step the trainer marked as gating this package', async () => {
    h.stepFindFirst.mockResolvedValueOnce({ id: 'step_1', payload: { formId: FORM } })
    const g = await bookingGateFor({ packageId: PKG })
    expect(g?.formId).toBe(FORM)
    expect(h.stepFindFirst.mock.calls[0][0].where).toMatchObject({
      packageId: PKG,
      kind: 'FORM',
      gatesBooking: true,
      enabled: true,
    })
  })

  it('is null when the offering has no gating step', async () => {
    expect(await bookingGateFor({ packageId: PKG })).toBeNull()
  })

  // Switching the step off in the flow editor has to take the gate down with it:
  // what disappears from the screen disappears from the booking.
  it('only ever looks at enabled steps', async () => {
    await bookingGateFor({ packageId: PKG })
    expect(h.stepFindFirst.mock.calls[0][0].where.enabled).toBe(true)
  })

  // A half-built step must not make an offering unbookable. The editor warns the
  // trainer in amber; the engine skips it, exactly as flowStepConfigProblem does.
  it('is null when the step names no form', async () => {
    h.stepFindFirst.mockResolvedValueOnce({ id: 'step_1', payload: {} })
    expect(await bookingGateFor({ packageId: PKG })).toBeNull()
  })

  it('is null when the named form was deleted or is a draft', async () => {
    h.stepFindFirst.mockResolvedValue({ id: 'step_1', payload: { formId: FORM } })
    h.formFindUnique.mockResolvedValueOnce(null)
    expect(await bookingGateFor({ packageId: PKG })).toBeNull()

    h.formFindUnique.mockResolvedValueOnce(formRow({ isActive: false }))
    expect(await bookingGateFor({ packageId: PKG })).toBeNull()
  })

  // A gate with nothing to answer would add a step to the wizard that says
  // nothing and costs a tap.
  it('is null when the form has no questions', async () => {
    h.stepFindFirst.mockResolvedValueOnce({ id: 'step_1', payload: { formId: FORM } })
    h.formFindUnique.mockResolvedValueOnce(formRow({ questions: [] }))
    expect(await bookingGateFor({ packageId: PKG })).toBeNull()
  })

  // A class run's own step wins; the offering's applies to every run that has
  // not overridden it.
  it('prefers the run’s own step over the offering’s', async () => {
    h.stepFindFirst
      .mockResolvedValueOnce({ id: 'step_run', payload: { formId: FORM } })
      .mockResolvedValueOnce({ id: 'step_pkg', payload: { formId: FORM } })
    const g = await bookingGateFor({ classRunId: RUN, packageId: PKG })
    expect(g?.stepId).toBe('step_run')
    expect(h.stepFindFirst.mock.calls[0][0].where.classRunId).toBe(RUN)
  })

  it('falls back to the offering when the run has no step of its own', async () => {
    h.stepFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'step_pkg', payload: { formId: FORM } })
    const g = await bookingGateFor({ classRunId: RUN, packageId: PKG })
    expect(g?.stepId).toBe('step_pkg')
  })

  it('is null when asked about nothing', async () => {
    expect(await bookingGateFor({})).toBeNull()
    expect(h.stepFindFirst).not.toHaveBeenCalled()
  })
})

describe('gateRefusal — the server’s half of the gate', () => {
  it('lets a booking through when the offering has no gate', () => {
    expect(gateRefusal(null, undefined)).toBeNull()
  })

  // The crafted-POST case. `required` living only in FormRunner is exactly how
  // an empty intake once stamped itself complete and lifted the gate.
  it('refuses a booking that sent no answers at all', () => {
    const r = gateRefusal(gate(), undefined)
    expect(r?.code).toBe('FORM_REQUIRED')
    expect(r?.missing).toEqual(['q1'])
  })

  it('refuses a booking that skipped a required question', () => {
    expect(gateRefusal(gate(), { q2: 'nothing to report' })?.missing).toEqual(['q1'])
  })

  it('refuses whitespace as an answer', () => {
    expect(gateRefusal(gate(), { q1: '   ' })?.missing).toEqual(['q1'])
  })

  it('accepts a booking that answered what was required', () => {
    expect(gateRefusal(gate(), { q1: 'no' })).toBeNull()
  })

  // Same visibility rules as the browser: a required question hidden by its own
  // condition can't be answered, so it must never block.
  it('ignores a required question its own condition has hidden', () => {
    expect(gateRefusal(gate(), { q1: 'no' })).toBeNull()
  })

  it('…and enforces it once the condition reveals it', () => {
    expect(gateRefusal(gate(), { q1: 'yes' })?.missing).toEqual(['q3'])
    expect(gateRefusal(gate(), { q1: 'yes', q3: 'left ear' })).toBeNull()
  })
})

describe('pickGateAnswers', () => {
  it('keeps only the questions that are on this form', () => {
    expect(pickGateAnswers(gate(), { q1: 'no', notAQuestion: 'x'.repeat(10) })).toEqual({ q1: 'no' })
  })

  it('survives no answers at all', () => {
    expect(pickGateAnswers(gate(), null)).toEqual({})
  })
})

// ── The rule that makes it repeat ────────────────────────────────────────────
//
// "For every groom in a 1:1 package i ask the client the same questions before
// they confirm the booking… the next session it does the same thing."
describe('a completed answer set never satisfies the NEXT booking', () => {
  // The whole guarantee, stated as a property of the code: gateRefusal is pure
  // and takes only the gate and THIS request's answers. There is nothing it
  // could consult about the past even if somebody wanted it to.
  it('gateRefusal is decided by this request alone — it touches no database', async () => {
    const r = gateRefusal(gate(), { q1: 'no' })
    expect(r).toBeNull()
    expect(h.answerFindFirst).not.toHaveBeenCalled()
    expect(h.answerFindMany).not.toHaveBeenCalled()
  })

  // Session 1 answered, in the record, with the row present and findable — and
  // session 2's gate still refuses an empty booking.
  it('session 2 is gated again even though session 1 was answered', async () => {
    h.answerFindFirst.mockResolvedValue({ id: 'bfa_session_1' })
    // The record for session 1 exists…
    expect(await bookingAnswerExists({ formId: FORM, sessionId: 'sess_1' })).toBe(true)
    // …and the next booking, which sends nothing, is refused anyway.
    expect(gateRefusal(gate(), undefined)?.code).toBe('FORM_REQUIRED')
    expect(gateRefusal(gate(), {})?.code).toBe('FORM_REQUIRED')
  })

  // bookingAnswerExists is only for stopping the flow re-asking. If it were ever
  // wired into the gate it would have to be answerable by client alone — it
  // deliberately isn't.
  it('bookingAnswerExists cannot be asked about a client alone', async () => {
    expect(await bookingAnswerExists({ formId: FORM })).toBe(false)
    expect(h.answerFindFirst).not.toHaveBeenCalled()
  })
})

describe('recordBookingAnswers', () => {
  it('writes the answers against the session the booking made', async () => {
    await recordBookingAnswers({ bookingFormAnswer: { create: h.answerCreate } } as never, {
      trainerId: TRAINER,
      clientId: 'cl_1',
      formId: FORM,
      stepId: 'step_1',
      answers: { q1: 'no' },
      anchor: { sessionId: 'sess_1' },
    })
    expect(h.answerCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: TRAINER, clientId: 'cl_1', formId: FORM, sessionId: 'sess_1',
      enrollmentId: null, bookingRequestId: null,
    })
  })

  // A webhook can be delivered twice, and a retried booking must not fail on the
  // unique index that exists precisely to settle it.
  it('swallows the duplicate a redelivered webhook causes', async () => {
    h.answerCreate.mockRejectedValueOnce(Object.assign(new Error('dupe'), { code: 'P2002' }))
    await expect(
      recordBookingAnswers({ bookingFormAnswer: { create: h.answerCreate } } as never, {
        trainerId: TRAINER, clientId: 'cl_1', formId: FORM, answers: {}, anchor: { sessionId: 'sess_1' },
      }),
    ).resolves.toBeUndefined()
  })

  // A booking that has already happened must never be reported as failed because
  // the paperwork behind it didn't write.
  it('never throws at its caller', async () => {
    h.answerCreate.mockRejectedValueOnce(new Error('database on fire'))
    await expect(
      recordBookingAnswers({ bookingFormAnswer: { create: h.answerCreate } } as never, {
        trainerId: TRAINER, clientId: 'cl_1', formId: FORM, answers: {}, anchor: { sessionId: 'sess_1' },
      }),
    ).resolves.toBeUndefined()
  })
})

describe('carryRequestAnswersToSession', () => {
  // An approval-required offering asks BEFORE anybody has said yes, so the
  // answers wait on the request. Confirming has to move them, or the client
  // typed five things that ended up nowhere (bug #8).
  it('moves a request’s answers onto the session the approval created', async () => {
    h.answerFindMany.mockResolvedValueOnce([{ id: 'bfa_1' }])
    await carryRequestAnswersToSession(
      { bookingFormAnswer: { findMany: h.answerFindMany, update: h.answerUpdate } } as never,
      { bookingRequestId: 'req_1', sessionId: 'sess_new' },
    )
    expect(h.answerUpdate).toHaveBeenCalledWith({ where: { id: 'bfa_1' }, data: { sessionId: 'sess_new' } })
  })

  it('does nothing when the confirmation created no session', async () => {
    await carryRequestAnswersToSession(
      { bookingFormAnswer: { findMany: h.answerFindMany, update: h.answerUpdate } } as never,
      { bookingRequestId: 'req_1', sessionId: null },
    )
    expect(h.answerUpdate).not.toHaveBeenCalled()
  })
})
