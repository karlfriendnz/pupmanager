import { describe, it, expect, vi, beforeEach } from 'vitest'

// Starting a journey — and, just as importantly, NOT starting one.
//
// The live path here is the three-screen run in form-continuation.ts (enquiry →
// password → intake → their diary). It is in production. Every assertion below
// about a form with NO flow steps exists to prove that path did not move.

const h = vi.hoisted(() => ({
  stepFindMany: vi.fn(),
  stepFindFirst: vi.fn(),
  runFindFirst: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  clientFindUnique: vi.fn(),
  processFlowRun: vi.fn(),
  recordStepCompletion: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commsFlowStep: { findMany: h.stepFindMany, findFirst: h.stepFindFirst },
    flowRun: { findFirst: h.runFindFirst, create: h.runCreate, update: h.runUpdate },
    clientProfile: { findUnique: h.clientFindUnique },
  },
}))
vi.mock('@/lib/comms-flows', () => ({ processFlowRun: h.processFlowRun }))
vi.mock('@/lib/flow-steps', () => ({ recordStepCompletion: h.recordStepCompletion }))

import {
  formJourneySteps,
  journeyNeedsAccount,
  startEnquiryFlowRun,
  completeAccountStepForEnquiry,
} from '@/lib/flow-journey'

const ENQUIRY = 'enq-1'
const FORM = 'form-1'
const TRAINER = 'trainer-1'

function step(over: Partial<{ id: string; kind: string; blocking: boolean; enabled: boolean; order: number }> = {}) {
  return { id: 's1', kind: 'MESSAGE', blocking: false, enabled: true, order: 0, ...over }
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.stepFindMany.mockResolvedValue([])
  h.runFindFirst.mockResolvedValue(null)
  h.runCreate.mockResolvedValue({ id: 'run-1' })
  h.processFlowRun.mockResolvedValue({ asked: 0, waitingOn: null, completed: false })
})

describe('a form with NO flow steps is the live three-screen run, untouched', () => {
  it('starts no run at all', async () => {
    h.stepFindMany.mockResolvedValue([])
    const runId = await startEnquiryFlowRun({ enquiryId: ENQUIRY, formId: FORM, trainerId: TRAINER })
    expect(runId).toBeNull()
    expect(h.runCreate).not.toHaveBeenCalled()
    expect(h.processFlowRun).not.toHaveBeenCalled()
  })

  it('does not ask for an account, so the handover still keys off continueToAccount alone', async () => {
    expect(journeyNeedsAccount([])).toBe(false)
  })

  it('has nothing to advance when the password step finishes', async () => {
    h.runFindFirst.mockResolvedValue(null)
    const out = await completeAccountStepForEnquiry({ enquiryId: ENQUIRY, clientProfileId: 'c1' })
    expect(out).toBeNull()
    expect(h.runUpdate).not.toHaveBeenCalled()
    expect(h.recordStepCompletion).not.toHaveBeenCalled()
    expect(h.processFlowRun).not.toHaveBeenCalled()
  })
})

describe('formJourneySteps', () => {
  it('reads only the ENABLED steps, in order', async () => {
    await formJourneySteps(FORM)
    expect(h.stepFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { formId: FORM, enabled: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
    )
  })

  it('a switched-off ACCOUNT step is not an account step', () => {
    // formJourneySteps never returns it, so the flow does not "need an account"
    // — which has to agree with availableSteps, or the run would park on a step
    // the engine skips.
    expect(journeyNeedsAccount([step({ kind: 'MESSAGE' })])).toBe(false)
    expect(journeyNeedsAccount([step({ kind: 'ACCOUNT' })])).toBe(true)
  })
})

describe('startEnquiryFlowRun', () => {
  it('creates a person-anchored run tied to the enquiry, and walks it', async () => {
    h.stepFindMany.mockResolvedValue([step({ kind: 'ACCOUNT', blocking: true })])
    const runId = await startEnquiryFlowRun({ enquiryId: ENQUIRY, formId: FORM, trainerId: TRAINER })

    expect(runId).toBe('run-1')
    expect(h.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          trainerId: TRAINER,
          formId: FORM,
          trigger: 'ON_ENQUIRY_SUBMITTED',
          enquiryId: ENQUIRY,
        },
      }),
    )
    // No userId: the enquiry is written before the account exists.
    expect(h.runCreate.mock.calls[0][0].data).not.toHaveProperty('userId')
    expect(h.processFlowRun).toHaveBeenCalledWith('run-1')
  })

  it('is idempotent — a second submit finds the run it already made', async () => {
    h.stepFindMany.mockResolvedValue([step()])
    h.runFindFirst.mockResolvedValue({ id: 'run-existing' })
    const runId = await startEnquiryFlowRun({ enquiryId: ENQUIRY, formId: FORM, trainerId: TRAINER })
    expect(runId).toBe('run-existing')
    expect(h.runCreate).not.toHaveBeenCalled()
  })
})

describe('completeAccountStepForEnquiry', () => {
  beforeEach(() => {
    h.runFindFirst.mockResolvedValue({ id: 'run-1', formId: FORM })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', userId: 'u1' })
    h.stepFindFirst.mockResolvedValue({ id: 'account-step' })
    h.processFlowRun.mockResolvedValue({ asked: 1, waitingOn: 'next-step', completed: false })
  })

  it('only ever picks up an ACTIVE run', async () => {
    await completeAccountStepForEnquiry({ enquiryId: ENQUIRY, clientProfileId: 'c1' })
    expect(h.runFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enquiryId: ENQUIRY, status: 'ACTIVE' } }),
    )
  })

  it('attaches the person, ticks the account step off, and carries on', async () => {
    const out = await completeAccountStepForEnquiry({ enquiryId: ENQUIRY, clientProfileId: 'c1' })

    expect(h.runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { userId: 'u1', clientId: 'c1' },
    })
    // Without this completion the run parks on the account step for ever — it
    // is blocking, and the ledger is the only thing that moves the cursor.
    expect(h.recordStepCompletion).toHaveBeenCalledWith({
      stepId: 'account-step',
      userId: 'u1',
      runId: 'run-1',
    })
    expect(out).toEqual({ runId: 'run-1', waitingOn: 'next-step' })
  })

  it('still attaches the person when the flow has no ACCOUNT step in it', async () => {
    h.stepFindFirst.mockResolvedValue(null)
    await completeAccountStepForEnquiry({ enquiryId: ENQUIRY, clientProfileId: 'c1' })
    expect(h.runUpdate).toHaveBeenCalled()
    expect(h.recordStepCompletion).not.toHaveBeenCalled()
    // The run still moves — the steps after it are now reachable, because
    // somebody to send them to finally exists.
    expect(h.processFlowRun).toHaveBeenCalledWith('run-1')
  })

  it('does nothing for a client profile that has gone', async () => {
    h.clientFindUnique.mockResolvedValue(null)
    const out = await completeAccountStepForEnquiry({ enquiryId: ENQUIRY, clientProfileId: 'c1' })
    expect(out).toBeNull()
    expect(h.runUpdate).not.toHaveBeenCalled()
  })
})
