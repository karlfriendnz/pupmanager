import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Wait for this" only means something if something ever says it is done.
//
// Phase 3 found that exactly one kind of step got ticked off (ACCOUNT), hid the
// `blocking` toggle behind `canWaitForCompletion` and stripped it server-side —
// because a blocking step nothing can complete is a journey that stops dead.
// This file is the proof that three more kinds now genuinely finish.
//
// Every test drives the REAL ROUTE the client's own screen posts to. A test
// that called `recordStepCompletion` directly would prove the recorder works
// and nothing about whether the app ever calls it, which is precisely the gap
// phase 3 refused to ship over.
//
// `processFlowRun` is the one thing stubbed, and only its DELIVERY half: it is
// replaced by a stub that calls the real `advanceFlowRun`, so the cursor move —
// the behaviour under test — happens for real while push/email stay out of it.

const h = vi.hoisted(() => ({
  // The flow engine's own tables.
  runFindMany: vi.fn(),
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  stepFindMany: vi.fn(),
  completionFindMany: vi.fn(),
  completionFindFirst: vi.fn(),
  completionCreate: vi.fn(),
  // Everything the four routes need.
  auth: vi.fn(),
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  clientFindFirst: vi.fn(),
  clientUpdate: vi.fn(),
  formFindFirst: vi.fn(),
  embedFindFirst: vi.fn(),
  customFieldFindMany: vi.fn(),
  enquiryCreate: vi.fn(),
  dogFindUnique: vi.fn(),
  dogUpdate: vi.fn(),
  taskFindFirst: vi.fn(),
  taskCount: vi.fn(),
  taskCompletionFindUnique: vi.fn(),
  taskCompletionUpsert: vi.fn(),
  taskCompletionCount: vi.fn(),
  put: vi.fn(),
  safeEvaluate: vi.fn(),
  notifyTrainer: vi.fn(),
  notifyEnquiryTrainer: vi.fn(),
  sendFormAutoReply: vi.fn(),
  enforceRateLimit: vi.fn(),
  formJourneySteps: vi.fn(),
  startEnquiryFlowRun: vi.fn(),
  processFlowRun: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flowRun: { findMany: h.runFindMany, findUnique: h.runFindUnique, update: h.runUpdate },
    commsFlowStep: { findMany: h.stepFindMany },
    flowStepCompletion: {
      findMany: h.completionFindMany,
      findFirst: h.completionFindFirst,
      create: h.completionCreate,
    },
    clientProfile: { findUnique: h.clientFindUnique, findFirst: h.clientFindFirst, update: h.clientUpdate },
    form: { findFirst: h.formFindFirst },
    embedForm: { findFirst: h.embedFindFirst },
    customField: { findMany: h.customFieldFindMany },
    enquiry: { create: h.enquiryCreate },
    dog: { findUnique: h.dogFindUnique, update: h.dogUpdate },
    trainingTask: { findFirst: h.taskFindFirst, count: h.taskCount },
    taskCompletion: {
      findUnique: h.taskCompletionFindUnique,
      upsert: h.taskCompletionUpsert,
      count: h.taskCompletionCount,
    },
  },
}))

// The delivery half of a journey is stubbed; the ADVANCE is real.
vi.mock('@/lib/comms-flows', async () => {
  const { advanceFlowRun } = await import('@/lib/flow-steps')
  return {
    processFlowRun: h.processFlowRun.mockImplementation(async (runId: string) => {
      const { currentStepId, completed } = await advanceFlowRun(runId)
      return { asked: 0, waitingOn: currentStepId, completed }
    }),
  }
})

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@vercel/blob', () => ({ put: h.put }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/notify-enquiry-trainer', () => ({ notifyEnquiryTrainer: h.notifyEnquiryTrainer }))
vi.mock('@/lib/form-auto-reply', () => ({ sendFormAutoReply: h.sendFormAutoReply }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: () => '1.2.3.4' }))
vi.mock('@/lib/flow-journey', () => ({
  formJourneySteps: h.formJourneySteps,
  journeyNeedsAccount: () => false,
  startEnquiryFlowRun: h.startEnquiryFlowRun,
}))

import { POST as submitIntake } from '@/app/api/my/intake-form/submit/route'
import { POST as submitPublicForm } from '@/app/api/form/[formId]/submit/route'
import { POST as uploadDogPhoto } from '@/app/api/dogs/[dogId]/photo/route'
import { POST as completeTask } from '@/app/api/tasks/[taskId]/complete/route'

const TRAINER = 'trainer-1'
const CLIENT = 'client-1'
const USER = 'user-1'
const RUN = 'run-1'
const FORM = 'form-1'
const DOG = 'dog-1'

interface Step {
  id: string
  kind: string
  order: number
  blocking: boolean
  enabled: boolean
  payload: unknown
}

function step(id: string, kind: string, order: number, over: Partial<Step> = {}): Step {
  return { id, kind, order, blocking: true, enabled: true, payload: null, ...over }
}

// ── The world one run walks through ─────────────────────────────────────────
// A tiny in-memory ledger, because the whole question here is "did a row get
// written, and did the cursor move because of it". `create` throws on a
// duplicate exactly as the unique (step, run, user) index does, so the
// idempotency test exercises the real conflict rather than a polite no-op.
let steps: Step[] = []
let ledger: string[] = []

function setJourney(next: Step[]) {
  steps = next
  ledger = []
}

/** The last cursor the engine wrote. */
function cursor(): { currentStepId: string | null; status: string } | null {
  const calls = h.runUpdate.mock.calls
  if (calls.length === 0) return null
  return calls[calls.length - 1][0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  setJourney([])

  h.runFindMany.mockImplementation(async () => [
    { id: RUN, userId: USER, clientId: CLIENT, trainerId: TRAINER, formId: FORM, packageId: null },
  ])
  h.runFindUnique.mockImplementation(async () => ({
    id: RUN, formId: FORM, packageId: null, userId: USER, status: 'ACTIVE',
  }))
  h.runUpdate.mockImplementation(async () => ({ id: RUN }))
  h.stepFindMany.mockImplementation(async () => steps)
  h.completionFindMany.mockImplementation(async () => ledger.map(stepId => ({ stepId })))
  h.completionCreate.mockImplementation(async ({ data }: { data: { stepId: string } }) => {
    if (ledger.includes(data.stepId)) throw new Error('Unique constraint failed')
    ledger.push(data.stepId)
    return { id: `c-${data.stepId}` }
  })

  h.auth.mockResolvedValue({ user: { id: USER, role: 'CLIENT', trainerId: null } })
  h.getActiveClient.mockResolvedValue({ clientId: CLIENT, isPreview: false })
  h.processFlowRun.mockClear()
})

// ── FORM ────────────────────────────────────────────────────────────────────

describe('FORM — the client fills the form in', () => {
  beforeEach(() => {
    h.clientFindUnique.mockResolvedValue({
      id: CLIENT, trainerId: TRAINER, intakeFormId: FORM, intakeCompletedAt: null,
    })
    h.formFindFirst.mockResolvedValue({ questions: [] })
    h.clientUpdate.mockResolvedValue({ id: CLIENT })
  })

  const intake = (formId = FORM) =>
    submitIntake(new Request('https://x/api/my/intake-form/submit', {
      method: 'POST',
      body: JSON.stringify({ formId, answers: { q1: 'yes' } }),
    }))

  it('records the completion for the step that asked, from the real submit route', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } }), step('m1', 'MESSAGE', 1, { blocking: false })])

    const res = await intake()
    expect(res.status).toBe(200)
    expect(h.completionCreate).toHaveBeenCalledTimes(1)
    const data = h.completionCreate.mock.calls[0][0].data
    expect(data.stepId).toBe('f1')
    expect(data.runId).toBe(RUN)
    // The RUN's person, not whoever happened to make the request.
    expect(data.userId).toBe(USER)
  })

  it('moves the blocking run on — and only once the answers are in', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } }), step('m1', 'MESSAGE', 1, { blocking: false })])

    // A submission of a DIFFERENT form is not this step's answer.
    h.clientFindUnique.mockResolvedValue({
      id: CLIENT, trainerId: TRAINER, intakeFormId: 'other-form', intakeCompletedAt: null,
    })
    await intake('other-form')
    expect(h.completionCreate).not.toHaveBeenCalled()
    expect(h.runUpdate).not.toHaveBeenCalled()

    // The real one does move it.
    h.clientFindUnique.mockResolvedValue({
      id: CLIENT, trainerId: TRAINER, intakeFormId: FORM, intakeCompletedAt: null,
    })
    await intake()
    expect(cursor()).toMatchObject({ currentStepId: 'm1', status: 'ACTIVE' })
  })

  it('closes the run when the last step was the wall', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    await intake()
    expect(cursor()).toMatchObject({ currentStepId: null, status: 'COMPLETED' })
  })

  it('leaves a step behind an unfinished wall alone', async () => {
    // Nothing can answer step two while step one is still open — availableSteps
    // never offers it, so submitting its form early must not tick it off.
    setJourney([
      step('a1', 'ACCOUNT', 0),
      step('f1', 'FORM', 1, { payload: { formId: FORM } }),
    ])
    await intake()
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('scopes the search to this person and this business', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    await intake()
    expect(h.runFindMany.mock.calls[0][0].where).toMatchObject({
      status: 'ACTIVE', userId: USER, clientId: CLIENT, trainerId: TRAINER,
    })
  })

  it('is idempotent — a second submission neither doubles nor re-advances', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } }), step('m1', 'MESSAGE', 1, { blocking: false })])
    await intake()
    expect(h.completionCreate).toHaveBeenCalledTimes(1)

    // The gate on the route itself is intakeCompletedAt, so re-submitting is
    // refused there. Drive the recorder through the OTHER real route instead,
    // which has no such gate, and prove the ledger settles it.
    h.formFindFirst.mockResolvedValue({
      id: FORM, trainerId: TRAINER, questions: [], continueToAccount: false, usableAsEnquiry: true,
    })
    h.embedFindFirst.mockResolvedValue(null)
    h.enforceRateLimit.mockResolvedValue(null)
    h.formJourneySteps.mockResolvedValue([])
    h.enquiryCreate.mockResolvedValue({ id: 'enq-1' })

    await submitPublicForm(
      new Request(`https://x/api/form/${FORM}/submit`, {
        method: 'POST',
        body: JSON.stringify({ contact: { name: 'Sarah', email: 's@example.com' }, answers: {} }),
      }),
      { params: Promise.resolve({ formId: FORM }) },
    )

    // Still one row, because the step is no longer open.
    expect(h.completionCreate).toHaveBeenCalledTimes(1)
    // …and the cursor is where it was, not one further on.
    expect(cursor()).toMatchObject({ currentStepId: 'm1' })
  })

  it('a duplicate that races the index is swallowed, not raised', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    // The ledger says nothing yet, but the insert loses to a concurrent one.
    h.completionCreate.mockRejectedValue(new Error('Unique constraint failed'))
    const res = await intake()
    expect(res.status).toBe(200)
  })

  it('never fails the submission when the flow blows up', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    h.runFindMany.mockRejectedValue(new Error('database is on fire'))
    const res = await intake()
    expect(res.status).toBe(200)
  })
})

// ── UPLOAD ──────────────────────────────────────────────────────────────────

describe('UPLOAD — the photo lands on the dog', () => {
  beforeEach(() => {
    h.dogFindUnique.mockResolvedValue({ id: DOG, clientProfileId: CLIENT, primaryFor: [] })
    h.clientFindUnique.mockResolvedValue({ trainerId: TRAINER })
    h.clientFindFirst.mockResolvedValue({ id: CLIENT })
    h.put.mockResolvedValue({ url: 'https://blob/dog.jpg' })
    h.dogUpdate.mockResolvedValue({ id: DOG, photoUrl: 'https://blob/dog.jpg' })
  })

  function upload() {
    const body = new FormData()
    body.set('file', new File([new Uint8Array([1, 2, 3])], 'bailey.jpg', { type: 'image/jpeg' }))
    return uploadDogPhoto(
      new Request(`https://x/api/dogs/${DOG}/photo`, { method: 'POST', body }),
      { params: Promise.resolve({ dogId: DOG }) },
    )
  }

  it('ticks off a DOG_PHOTO step from the route the photo actually arrives at', async () => {
    setJourney([
      step('u1', 'UPLOAD', 0, { payload: { target: 'DOG_PHOTO' } }),
      step('m1', 'MESSAGE', 1, { blocking: false }),
    ])
    const res = await upload()
    expect(res.status).toBe(200)
    expect(h.completionCreate.mock.calls[0][0].data.stepId).toBe('u1')
    // The picture is written by this route and nowhere else — there is no
    // second uploader, so the dog's own row is what changed.
    expect(h.dogUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { photoUrl: 'https://blob/dog.jpg' },
    }))
    expect(cursor()).toMatchObject({ currentStepId: 'm1' })
  })

  it('keeps the uploaded URL on the completion, so the trainer can see what came in', async () => {
    setJourney([step('u1', 'UPLOAD', 0, { payload: { target: 'DOG_PHOTO' } })])
    await upload()
    expect(h.completionCreate.mock.calls[0][0].data.result).toEqual({
      dogId: DOG, urls: ['https://blob/dog.jpg'],
    })
  })

  // An ATTACHMENT has no screen of its own to land on, which is exactly why
  // canWaitForCompletion refuses to let one block. A dog photo must not be
  // mistaken for one arriving.
  it('does not tick off an ATTACHMENT step', async () => {
    setJourney([step('u1', 'UPLOAD', 0, { payload: { target: 'ATTACHMENT' } })])
    await upload()
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('an unconfigured UPLOAD defaults to ATTACHMENT and stays untouched', async () => {
    setJourney([step('u1', 'UPLOAD', 0, { payload: null })])
    await upload()
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('still saves the photo when the flow cannot be advanced', async () => {
    setJourney([step('u1', 'UPLOAD', 0, { payload: { target: 'DOG_PHOTO' } })])
    h.runFindMany.mockRejectedValue(new Error('nope'))
    const res = await upload()
    expect(res.status).toBe(200)
    expect(h.dogUpdate).toHaveBeenCalled()
  })
})

// ── TASK ────────────────────────────────────────────────────────────────────

describe('TASK — the client ticks their homework off', () => {
  beforeEach(() => {
    h.taskCompletionFindUnique.mockResolvedValue(null)
    h.taskCompletionUpsert.mockResolvedValue({ taskId: 'task-1' })
    h.safeEvaluate.mockResolvedValue(undefined)
    // Not the last task on the list, so the trainer-notify branch stays out of
    // the way of what is being tested.
    h.taskCount.mockResolvedValue(5)
    h.taskCompletionCount.mockResolvedValue(1)
  })

  function tick(task: { title: string; libraryTaskId: string | null }) {
    h.taskFindFirst.mockResolvedValue({ id: 'task-1', clientId: CLIENT, ...task })
    return completeTask(
      new Request('https://x/api/tasks/task-1/complete', { method: 'POST', body: JSON.stringify({}) }),
      { params: Promise.resolve({ taskId: 'task-1' }) },
    )
  }

  it('ticks off the inline step that handed that homework out', async () => {
    setJourney([
      step('t1', 'TASK', 0, { payload: { title: 'Settle on mat' } }),
      step('m1', 'MESSAGE', 1, { blocking: false }),
    ])
    const res = await tick({ title: 'Settle on mat', libraryTaskId: null })
    expect(res.status).toBe(200)
    expect(h.completionCreate.mock.calls[0][0].data.stepId).toBe('t1')
    expect(cursor()).toMatchObject({ currentStepId: 'm1' })
  })

  // Matched the same way assignFlowTask de-duplicates, so a step and the task
  // it created cannot disagree about which is which.
  it('matches on the library item when the step uses one', async () => {
    setJourney([step('t1', 'TASK', 0, { payload: { libraryTaskId: 'lib-9' } })])
    await tick({ title: 'Whatever the library calls it now', libraryTaskId: 'lib-9' })
    expect(h.completionCreate.mock.calls[0][0].data.stepId).toBe('t1')
  })

  it('does not tick off a step for somebody else’s homework', async () => {
    setJourney([step('t1', 'TASK', 0, { payload: { title: 'Settle on mat' } })])
    await tick({ title: 'Loose lead walking', libraryTaskId: null })
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('ignores case, as the hand-out’s own dedupe does', async () => {
    setJourney([step('t1', 'TASK', 0, { payload: { title: 'Settle On Mat' } })])
    await tick({ title: 'settle on mat', libraryTaskId: null })
    expect(h.completionCreate).toHaveBeenCalled()
  })

  it('does nothing on a re-tick of an already-done task', async () => {
    setJourney([step('t1', 'TASK', 0, { payload: { title: 'Settle on mat' } })])
    h.taskCompletionFindUnique.mockResolvedValue({ taskId: 'task-1' })
    await tick({ title: 'Settle on mat', libraryTaskId: null })
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('still records the tick when the flow blows up', async () => {
    setJourney([step('t1', 'TASK', 0, { payload: { title: 'Settle on mat' } })])
    h.runFindMany.mockRejectedValue(new Error('nope'))
    const res = await tick({ title: 'Settle on mat', libraryTaskId: null })
    expect(res.status).toBe(200)
    expect(h.taskCompletionUpsert).toHaveBeenCalled()
  })
})

// ── Runs that must be left alone ────────────────────────────────────────────

describe('runs nothing may tick off', () => {
  beforeEach(() => {
    h.clientFindUnique.mockResolvedValue({
      id: CLIENT, trainerId: TRAINER, intakeFormId: FORM, intakeCompletedAt: null,
    })
    h.formFindFirst.mockResolvedValue({ questions: [] })
    h.clientUpdate.mockResolvedValue({ id: CLIENT })
  })

  const intake = () =>
    submitIntake(new Request('https://x/api/my/intake-form/submit', {
      method: 'POST',
      body: JSON.stringify({ formId: FORM, answers: {} }),
    }))

  it('skips a run with nobody walking it', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    h.runFindMany.mockResolvedValue([
      { id: RUN, userId: null, clientId: CLIENT, trainerId: TRAINER, formId: FORM, packageId: null },
    ])
    await intake()
    expect(h.completionCreate).not.toHaveBeenCalled()
  })

  it('only ever looks at ACTIVE runs', async () => {
    setJourney([step('f1', 'FORM', 0, { payload: { formId: FORM } })])
    await intake()
    expect(h.runFindMany.mock.calls[0][0].where.status).toBe('ACTIVE')
  })

  it('skips a disabled step — a paused step is not a step', async () => {
    setJourney([step('f1', 'FORM', 0, { enabled: false, payload: { formId: FORM } })])
    await intake()
    expect(h.completionCreate).not.toHaveBeenCalled()
  })
})
