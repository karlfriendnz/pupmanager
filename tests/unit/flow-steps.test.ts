import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The flow ENGINE's primitives — phase 1 of the flow builder.
 *
 * Three things are pinned here, because all three are seams the later phases
 * hang off and a seam that is wrong is worse than one that is missing:
 *
 *   1. TRIGGER RESOLUTION. `trigger` is null on every row that exists, and its
 *      real value lives in `direction`. There is exactly one function allowed to
 *      know that.
 *   2. SEQUENCING. A person-anchored flow advances when a step is COMPLETED,
 *      not when a timer expires, and a `blocking` step is a wall.
 *   3. THE COMPLETION LEDGER. The mirror of CommsFlowSend, with the same
 *      idempotency idiom — the unique index settles a double-submit, and the
 *      conflict is swallowed rather than raised.
 *
 * Nothing in the app writes a completion yet. These tests are the only caller,
 * which is the point: phase 2 is additive.
 */

const h = vi.hoisted(() => ({
  completionCreate: vi.fn(),
  completionFindFirst: vi.fn(),
  completionFindMany: vi.fn(),
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  stepFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flowStepCompletion: {
      create: h.completionCreate,
      findFirst: h.completionFindFirst,
      findMany: h.completionFindMany,
    },
    flowRun: { findUnique: h.runFindUnique, update: h.runUpdate },
    commsFlowStep: { findMany: h.stepFindMany },
  },
}))

import {
  flowTriggerFor,
  flowAnchorFor,
  isCronDelivered,
  availableSteps,
  nextStepFor,
  recordStepCompletion,
  isStepCompleteFor,
  completedStepIdsFor,
  advanceFlowRun,
} from '@/lib/flow-steps'

beforeEach(() => {
  vi.clearAllMocks()
  h.completionCreate.mockResolvedValue({})
  h.completionFindFirst.mockResolvedValue(null)
  h.completionFindMany.mockResolvedValue([])
  h.runUpdate.mockResolvedValue({})
})

// ─── 1. Trigger resolution ──────────────────────────────────────────────────

describe('flowTriggerFor', () => {
  it('reads the direction when the row has no trigger — every existing row', () => {
    expect(flowTriggerFor({ trigger: null, direction: 'BEFORE_SESSION' })).toBe('BEFORE_SESSION')
    expect(flowTriggerFor({ trigger: null, direction: 'AFTER_SESSION' })).toBe('AFTER_SESSION')
    expect(flowTriggerFor({ trigger: null, direction: 'AFTER_PURCHASE' })).toBe('AFTER_PURCHASE')
    expect(flowTriggerFor({ trigger: null, direction: 'BEFORE_PERIOD_END' })).toBe('BEFORE_PERIOD_END')
  })

  it('treats an absent trigger the same as a null one', () => {
    expect(flowTriggerFor({ direction: 'AFTER_SESSION' })).toBe('AFTER_SESSION')
  })

  it('prefers the trigger when the row sets one', () => {
    expect(flowTriggerFor({ trigger: 'ON_ENQUIRY_SUBMITTED', direction: 'BEFORE_SESSION' })).toBe(
      'ON_ENQUIRY_SUBMITTED',
    )
  })

  // Anything else means the column has gone wrong; a reminder that silently
  // stops firing is worse than one that fires on the old schedule.
  it('falls back to before-session on a direction it does not know', () => {
    expect(flowTriggerFor({ trigger: null, direction: 'SOMETHING_NEW' })).toBe('BEFORE_SESSION')
  })
})

describe('flowAnchorFor', () => {
  it('anchors the two session directions on the session', () => {
    expect(flowAnchorFor({ trigger: null, direction: 'BEFORE_SESSION' })).toBe('SESSION')
    expect(flowAnchorFor({ trigger: null, direction: 'AFTER_SESSION' })).toBe('SESSION')
  })

  it('anchors the two membership directions on the purchase', () => {
    expect(flowAnchorFor({ trigger: null, direction: 'AFTER_PURCHASE' })).toBe('PURCHASE')
    expect(flowAnchorFor({ trigger: null, direction: 'BEFORE_PERIOD_END' })).toBe('PURCHASE')
  })

  it('anchors the three journey triggers on the person', () => {
    for (const trigger of ['ON_ENQUIRY_SUBMITTED', 'ON_SIGNUP', 'ON_BOOKING'] as const) {
      expect(flowAnchorFor({ trigger, direction: 'BEFORE_SESSION' })).toBe('PERSON')
    }
  })
})

describe('isCronDelivered', () => {
  it('is true for a timed message — the only thing the cron has ever sent', () => {
    expect(isCronDelivered({ kind: 'MESSAGE', trigger: null, direction: 'BEFORE_SESSION' })).toBe(true)
    expect(isCronDelivered({ kind: 'MESSAGE', trigger: null, direction: 'AFTER_PURCHASE' })).toBe(true)
  })

  it('is false for every kind that is a thing a person does', () => {
    for (const kind of ['FORM', 'UPLOAD', 'TASK', 'ACCOUNT', 'CHOOSE_OFFERING', 'APPROVAL'] as const) {
      expect(isCronDelivered({ kind, trigger: null, direction: 'BEFORE_SESSION' })).toBe(false)
    }
  })

  it('is false for a message the run unlocks rather than the clock', () => {
    expect(isCronDelivered({ kind: 'MESSAGE', trigger: 'ON_SIGNUP', direction: 'BEFORE_SESSION' })).toBe(false)
  })
})

// ─── 2. Sequencing ──────────────────────────────────────────────────────────

const s = (id: string, order: number, over: Partial<{ blocking: boolean; enabled: boolean }> = {}) => ({
  id,
  order,
  blocking: false,
  enabled: true,
  ...over,
})

describe('availableSteps', () => {
  it('offers every step at once when nothing blocks', () => {
    const steps = [s('a', 0), s('b', 1), s('c', 2)]
    expect(availableSteps(steps, []).map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('stops dead at the first blocking step that is not done', () => {
    const steps = [s('account', 0, { blocking: true }), s('intake', 1), s('choose', 2)]
    expect(availableSteps(steps, []).map(x => x.id)).toEqual(['account'])
  })

  it('opens the next one once the blocker is completed', () => {
    const steps = [s('account', 0, { blocking: true }), s('intake', 1, { blocking: true }), s('choose', 2)]
    expect(availableSteps(steps, ['account']).map(x => x.id)).toEqual(['intake'])
    expect(availableSteps(steps, ['account', 'intake']).map(x => x.id)).toEqual(['choose'])
  })

  it('reads in `order`, not in the order it was handed them', () => {
    const steps = [s('third', 2), s('first', 0, { blocking: true }), s('second', 1)]
    expect(availableSteps(steps, []).map(x => x.id)).toEqual(['first'])
  })

  // A paused step that still blocked would strand every person mid-journey the
  // moment a trainer switched it off — with no way for them to get unstuck.
  it('a disabled blocker is skipped, not treated as a wall', () => {
    const steps = [s('paused', 0, { blocking: true, enabled: false }), s('next', 1)]
    expect(availableSteps(steps, []).map(x => x.id)).toEqual(['next'])
  })

  it('returns nothing when everything is done', () => {
    const steps = [s('a', 0), s('b', 1)]
    expect(availableSteps(steps, ['a', 'b'])).toEqual([])
  })
})

describe('nextStepFor', () => {
  it('is the first unfinished step', () => {
    const steps = [s('a', 0), s('b', 1), s('c', 2)]
    expect(nextStepFor(steps, ['a'])?.id).toBe('b')
  })

  it('is null when the journey is over', () => {
    expect(nextStepFor([s('a', 0)], ['a'])).toBeNull()
  })
})

// ─── 3. The completion ledger ───────────────────────────────────────────────

describe('recordStepCompletion', () => {
  it('writes the person-anchored row with exactly one anchor set', async () => {
    await recordStepCompletion({ stepId: 'st1', userId: 'u1', runId: 'run1' })
    expect(h.completionCreate).toHaveBeenCalledWith({
      data: { stepId: 'st1', userId: 'u1', runId: 'run1', sessionId: null, purchaseId: null, result: undefined },
    })
  })

  it('writes a session-anchored row the same way', async () => {
    await recordStepCompletion({ stepId: 'st1', userId: 'u1', sessionId: 'sess1' })
    expect(h.completionCreate.mock.calls[0][0].data).toMatchObject({
      sessionId: 'sess1',
      runId: null,
      purchaseId: null,
    })
  })

  it('keeps what they actually did', async () => {
    await recordStepCompletion({ stepId: 'st1', userId: 'u1', runId: 'r1', result: { photoUrl: 'x' } })
    expect(h.completionCreate.mock.calls[0][0].data.result).toEqual({ photoUrl: 'x' })
  })

  // The same idiom CommsFlowSend uses: the unique (step, anchor, user) index is
  // what settles a double-tapped button, and the loser swallows the conflict
  // rather than 500ing at somebody who did nothing wrong.
  it('swallows the unique-violation when two submits race', async () => {
    h.completionCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    await expect(recordStepCompletion({ stepId: 'st1', userId: 'u1', runId: 'r1' })).resolves.toBeUndefined()
  })

  it('is idempotent from the caller\'s point of view — twice is once', async () => {
    await recordStepCompletion({ stepId: 'st1', userId: 'u1', runId: 'r1' })
    h.completionCreate.mockRejectedValueOnce(Object.assign(new Error('dupe'), { code: 'P2002' }))
    await recordStepCompletion({ stepId: 'st1', userId: 'u1', runId: 'r1' })
    // Both calls carry the identical key, so the database keeps one row.
    expect(h.completionCreate.mock.calls[0][0].data).toEqual(h.completionCreate.mock.calls[1][0].data)
  })
})

describe('isStepCompleteFor', () => {
  it('is false when there is no row', async () => {
    expect(await isStepCompleteFor({ stepId: 'st1', userId: 'u1', runId: 'r1' })).toBe(false)
  })

  it('is true when there is', async () => {
    h.completionFindFirst.mockResolvedValue({ id: 'c1' })
    expect(await isStepCompleteFor({ stepId: 'st1', userId: 'u1', runId: 'r1' })).toBe(true)
  })

  // The unique index cannot be addressed with findUnique when two of its three
  // columns are null — Postgres treats NULL as distinct from NULL.
  it('matches on the null anchors too, so a run row is not confused with a session one', async () => {
    await isStepCompleteFor({ stepId: 'st1', userId: 'u1', runId: 'r1' })
    expect(h.completionFindFirst.mock.calls[0][0].where).toEqual({
      stepId: 'st1',
      userId: 'u1',
      runId: 'r1',
      sessionId: null,
      purchaseId: null,
    })
  })
})

describe('completedStepIdsFor', () => {
  it('returns just the step ids', async () => {
    h.completionFindMany.mockResolvedValue([{ stepId: 'a' }, { stepId: 'b' }])
    expect(await completedStepIdsFor({ userId: 'u1', runId: 'r1' })).toEqual(['a', 'b'])
  })
})

// ─── 4. The cursor ──────────────────────────────────────────────────────────

describe('advanceFlowRun', () => {
  beforeEach(() => {
    h.runFindUnique.mockResolvedValue({ id: 'r1', formId: 'f1', packageId: null, userId: 'u1', status: 'ACTIVE' })
    h.stepFindMany.mockResolvedValue([s('account', 0, { blocking: true }), s('intake', 1), s('choose', 2)])
  })

  it('parks the cursor on the first unfinished step', async () => {
    const out = await advanceFlowRun('r1')
    expect(out).toEqual({ currentStepId: 'account', completed: false })
    expect(h.runUpdate.mock.calls[0][0].data).toMatchObject({ currentStepId: 'account', status: 'ACTIVE', completedAt: null })
  })

  it('moves it on as steps are completed', async () => {
    h.completionFindMany.mockResolvedValue([{ stepId: 'account' }])
    expect(await advanceFlowRun('r1')).toEqual({ currentStepId: 'intake', completed: false })
  })

  it('closes the run when there is nothing left to do', async () => {
    h.completionFindMany.mockResolvedValue([{ stepId: 'account' }, { stepId: 'intake' }, { stepId: 'choose' }])
    const out = await advanceFlowRun('r1')
    expect(out).toEqual({ currentStepId: null, completed: true })
    const data = h.runUpdate.mock.calls[0][0].data
    expect(data.status).toBe('COMPLETED')
    expect(data.completedAt).toBeInstanceOf(Date)
  })

  // Derived, never incremented. A cursor written forward one step at a time
  // strands somebody the first time a step is deleted underneath them.
  it('recovers when the step it was parked on has gone', async () => {
    h.stepFindMany.mockResolvedValue([s('intake', 1), s('choose', 2)]) // 'account' deleted
    expect((await advanceFlowRun('r1')).currentStepId).toBe('intake')
  })

  it('reads the flow off the run\'s own scope', async () => {
    await advanceFlowRun('r1')
    expect(h.stepFindMany.mock.calls[0][0].where).toEqual({ formId: 'f1' })
    expect(h.completionFindMany.mock.calls[0][0].where).toEqual({ runId: 'r1' })
  })

  it('does nothing for a run that is not there', async () => {
    h.runFindUnique.mockResolvedValue(null)
    expect(await advanceFlowRun('gone')).toEqual({ currentStepId: null, completed: false })
    expect(h.runUpdate).not.toHaveBeenCalled()
  })
})

// ─── 5. The journey the model has to be able to express ─────────────────────
//
// src/lib/form-continuation.ts is a working, hard-coded version of exactly the
// journey Karl described: a public enquiry form hands over to a password step,
// then to the trainer's intake form, then to their diary — one run, no "check
// your email and start again" in the middle. `Form.continueToAccount` turns it
// on and `Form.continueIntakeFormId` names the intake form, which is why that
// page can say "Step 2 of 3" (`totalSteps = run.intakeFormId ? 3 : 2`).
//
// If the generalised model cannot express THAT, the model is wrong. So this
// builds it out of the new shape and walks it.
describe('the model expresses the existing enquiry → account → intake journey', () => {
  // What lib/form-continuation.ts does today, as flow steps. Each is blocking:
  // there is no version of this journey where you skip the password.
  const JOURNEY = [
    { id: 'account', order: 0, blocking: true, enabled: true, kind: 'ACCOUNT' as const, actor: 'CLIENT' as const },
    { id: 'intake', order: 1, blocking: true, enabled: true, kind: 'FORM' as const, actor: 'CLIENT' as const },
    { id: 'choose', order: 2, blocking: true, enabled: true, kind: 'CHOOSE_OFFERING' as const, actor: 'CLIENT' as const },
    // "the trainer gets a notification, the trainer accepts the time or moves
    // the time" — a step performed by the OTHER SIDE, which is why `actor`
    // exists at all.
    { id: 'accept', order: 3, blocking: true, enabled: true, kind: 'APPROVAL' as const, actor: 'TRAINER' as const },
  ]

  it('starts on the enquiry and parks them on the password step', () => {
    expect(flowAnchorFor({ trigger: 'ON_ENQUIRY_SUBMITTED', direction: 'BEFORE_SESSION' })).toBe('PERSON')
    expect(nextStepFor(JOURNEY, [])?.id).toBe('account')
  })

  it('shows one step at a time, in order, as each is finished', () => {
    expect(nextStepFor(JOURNEY, ['account'])?.id).toBe('intake')
    expect(nextStepFor(JOURNEY, ['account', 'intake'])?.id).toBe('choose')
    expect(nextStepFor(JOURNEY, ['account', 'intake', 'choose'])?.id).toBe('accept')
    expect(nextStepFor(JOURNEY, ['account', 'intake', 'choose', 'accept'])).toBeNull()
  })

  it('never runs ahead — the intake is unreachable until the account exists', () => {
    expect(availableSteps(JOURNEY, []).map(x => x.id)).toEqual(['account'])
  })

  // The trainer who nominates no intake form gets a two-step journey, which is
  // the `totalSteps = run.intakeFormId ? 3 : 2` line on the account page.
  it('is two steps long when the trainer nominated no intake form', () => {
    const withoutIntake = JOURNEY.filter(s => s.id !== 'intake' && s.id !== 'accept')
    expect(nextStepFor(withoutIntake, ['account'])?.id).toBe('choose')
    expect(nextStepFor(withoutIntake, ['account', 'choose'])).toBeNull()
  })

  it('the last step belongs to the trainer, not the client', () => {
    expect(JOURNEY.find(s => s.id === 'accept')?.actor).toBe('TRAINER')
  })

  // None of it goes through the reminders cron: no clock is involved anywhere.
  it('no step of it is delivered by the comms cron', () => {
    for (const step of JOURNEY) {
      expect(isCronDelivered({ kind: step.kind, trigger: 'ON_ENQUIRY_SUBMITTED', direction: 'BEFORE_SESSION' })).toBe(false)
    }
  })
})
