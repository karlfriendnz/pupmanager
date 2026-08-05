import { describe, it, expect, vi, beforeEach } from 'vitest'

// The public, UNAUTHENTICATED submit path for a unified Form published as a
// website enquiry form. Everything here is reachable by anyone with the URL,
// so required-field validation and field ownership are re-checked server-side.
const h = vi.hoisted(() => ({
  embedFindFirst: vi.fn(),
  formFindFirst: vi.fn(),
  customFieldFindMany: vi.fn(),
  enquiryCreate: vi.fn(),
  notifyEnquiryTrainer: vi.fn(),
  sendFormAutoReply: vi.fn(),
  enforceRateLimit: vi.fn(),
  // The form's flow steps. EMPTY for every test in this file, which is the
  // point: these are the assertions about the live three-screen run, and a form
  // with no flow must take exactly the path it always did.
  flowStepFindMany: vi.fn(),
  startEnquiryFlowRun: vi.fn(),
  // Nobody is signed in for any test in this file — these are the PUBLIC
  // submissions. The route reads the session only to decide whether this
  // submission also ANSWERS a flow step somebody was asked to fill in, and a
  // stranger's submission must never do that. See flow-completions.
  auth: vi.fn(),
  completeFormFlowSteps: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    embedForm: { findFirst: h.embedFindFirst },
    form: { findFirst: h.formFindFirst },
    customField: { findMany: h.customFieldFindMany },
    enquiry: { create: h.enquiryCreate },
    commsFlowStep: { findMany: h.flowStepFindMany },
  },
}))
vi.mock('@/lib/flow-journey', async () => ({
  ...(await vi.importActual<typeof import('@/lib/flow-journey')>('@/lib/flow-journey')),
  startEnquiryFlowRun: h.startEnquiryFlowRun,
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/flow-completions', () => ({ completeFormFlowSteps: h.completeFormFlowSteps }))
vi.mock('@/lib/notify-enquiry-trainer', () => ({ notifyEnquiryTrainer: h.notifyEnquiryTrainer }))
vi.mock('@/lib/form-auto-reply', () => ({ sendFormAutoReply: h.sendFormAutoReply }))
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: h.enforceRateLimit,
  getClientIp: () => '1.2.3.4',
}))

import { POST } from '@/app/api/form/[formId]/submit/route'

const TRAINER = 'trainer-1'
const FORM = 'form-1'

const CONTACT = { name: 'Sarah', email: 'sarah@example.com', phone: '021 555 0000' }

function post(body: unknown, formId = FORM) {
  return POST(
    new Request(`https://app.pupmanager.com/api/form/${formId}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ formId }) },
  )
}

const QUESTIONS = [
  { id: 'q1', type: 'DROPDOWN', label: 'Groomed before?', required: true, options: ['Yes', 'No'] },
  { id: 'q2', type: 'SHORT_TEXT', label: 'When?', required: true, showIf: { questionId: 'q1', equals: 'Yes' } },
  { id: 'q3', type: 'LONG_TEXT', label: 'Anything else?', required: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  // No legacy EmbedForm under this id → the unified path.
  h.embedFindFirst.mockResolvedValue(null)
  h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS })
  h.customFieldFindMany.mockResolvedValue([])
  h.flowStepFindMany.mockResolvedValue([])
  h.auth.mockResolvedValue(null)
  h.completeFormFlowSteps.mockResolvedValue(0)
  h.startEnquiryFlowRun.mockResolvedValue(null)
  h.enquiryCreate.mockResolvedValue({ id: 'enq-1' })
  h.notifyEnquiryTrainer.mockResolvedValue(undefined)
})

describe('public unified-form submit — resolution', () => {
  it('404s on a draft or non-enquiry form', async () => {
    h.formFindFirst.mockResolvedValue(null)
    expect((await post({ contact: CONTACT, answers: {} })).status).toBe(404)
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })

  it('only ever resolves an active, enquiry-published form', async () => {
    await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(h.formFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FORM, isActive: true, usableAsEnquiry: true }),
      }),
    )
  })

  it('is rate limited like every other public submit', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await post({ contact: CONTACT, answers: {} })).status).toBe(429)
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })
})

describe('public unified-form submit — validation', () => {
  it('rejects a missing or malformed contact', async () => {
    expect((await post({ contact: { name: '', email: 'x' }, answers: {} })).status).toBe(400)
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })

  it('rejects a missing answer to a visible required question', async () => {
    const res = await post({ contact: CONTACT, answers: {} })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Groomed before?')
  })

  it('does NOT require a question its own condition has hidden', async () => {
    // q2 is required, but only asked when q1 is "Yes".
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.enquiryCreate).toHaveBeenCalled()
  })

  it('DOES require it once the condition matches', async () => {
    const res = await post({ contact: CONTACT, answers: { q1: 'Yes' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('When?')
  })
})

describe('public unified-form submit — what gets stored', () => {
  it('records the form, the contact and the full answer set', async () => {
    await post({ contact: CONTACT, answers: { q1: 'No', q3: 'He pulls on the lead.' } })
    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.trainerId).toBe(TRAINER)
    expect(data.unifiedFormId).toBe(FORM)
    expect(data.formId).toBeUndefined()
    expect(data.name).toBe('Sarah')
    expect(data.formAnswers).toEqual({ q1: 'No', q3: 'He pulls on the lead.' })
    // The first long-text answer becomes the list preview line.
    expect(data.message).toBe('He pulls on the lead.')
  })

  it('snapshots ONLY linked answers to fields the trainer owns', async () => {
    // customFieldValues is what acceptEnquiry turns into CustomFieldValue rows;
    // a foreign or free-form id in there is a foreign-key violation on accept.
    h.formFindFirst.mockResolvedValue({
      id: FORM,
      trainerId: TRAINER,
      questions: [
        { id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'mine', required: false },
        { id: 'q2', type: 'CUSTOM_FIELD', customFieldId: 'theirs', required: false },
        { id: 'q3', type: 'SHORT_TEXT', label: 'Free text', required: false },
      ],
    })
    h.customFieldFindMany.mockResolvedValue([{ id: 'mine' }])

    await post({ contact: CONTACT, answers: { q1: 'Cocker', q2: 'leaked?', q3: 'free' } })
    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.customFieldValues).toEqual({ mine: 'Cocker' })
    // …while the full set still reaches the trainer for reading.
    expect(data.formAnswers).toEqual({ q1: 'Cocker', q2: 'leaked?', q3: 'free' })
  })

  it('notifies the trainer', async () => {
    await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(h.notifyEnquiryTrainer).toHaveBeenCalledWith({ enquiryId: 'enq-1' })
  })
})

// The continuous run's FIRST step. The enquiry is written whether or not the
// person ever gets as far as a password, which is the whole ordering decision:
// an enquiry the trainer can't reply to would be worse than no enquiry.
describe('public unified-form submit — the handover to an account', () => {
  it('ends at a thank-you card when the setting is off', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: false })

    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    const body = await res.json()

    expect(body.continueUrl).toBeUndefined()
    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.continuationTokenHash).toBeUndefined()
  })

  it('hands over to the password step when the setting is on', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: true })

    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.continueUrl).toMatch(new RegExp(`^/form/${FORM}/account\\?t=[0-9a-f]{64}$`))
  })

  it('writes the ENQUIRY first, so an abandoned run still reaches the trainer', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: true })

    await post({ contact: CONTACT, answers: { q1: 'No' } })

    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.name).toBe('Sarah')
    expect(data.email).toBe('sarah@example.com')
    expect(data.phone).toBe('021 555 0000')
    expect(h.notifyEnquiryTrainer).toHaveBeenCalledWith({ enquiryId: 'enq-1' })
  })

  it('stores only the token DIGEST, never the link that was handed out', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: true })

    const body = await (await post({ contact: CONTACT, answers: { q1: 'No' } })).json()
    const plain = new URL(body.continueUrl, 'https://x.test').searchParams.get('t')!
    const data = h.enquiryCreate.mock.calls[0][0].data

    expect(data.continuationTokenHash).toHaveLength(64)
    expect(data.continuationTokenHash).not.toBe(plain)
    expect(data.continuationExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('legacy EmbedForm submissions are untouched', () => {
  it('still takes the EmbedForm path when one exists under that id', async () => {
    h.embedFindFirst.mockResolvedValue({ id: 'embed-1', trainerId: TRAINER, customFieldIds: [] })
    h.sendFormAutoReply.mockResolvedValue(undefined)
    const res = await post(
      { name: 'Sarah', email: 'sarah@example.com', message: 'Hello' },
      'embed-1',
    )
    expect(res.status).toBe(201)
    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.formId).toBe('embed-1')
    expect(data.unifiedFormId).toBeUndefined()
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })
})

// A file question's answer is the list of URLs of what was already uploaded.
// This endpoint is public, so "did they attach the thing you asked for" is a
// question only the server may answer (AGENTS.md bug #3).
describe('public unified-form submit — a required file', () => {
  const FILE_Q = { id: 'q_photo', type: 'FILE_UPLOAD', label: 'A photo of your dog', required: true }

  beforeEach(() => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: [FILE_Q] })
  })

  it('refuses an enquiry where nothing was uploaded', async () => {
    for (const answers of [{}, { q_photo: [] }, { q_photo: '' }]) {
      const res = await post({ contact: CONTACT, answers })
      expect(res.status, JSON.stringify(answers)).toBe(400)
      expect((await res.json()).error).toContain('A photo of your dog')
    }
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })

  it('takes one where the file actually landed, and keeps the urls', async () => {
    const answers = { q_photo: ['https://blob.test/form-uploads/t/f/q_photo/a.jpg'] }
    expect((await post({ contact: CONTACT, answers })).status).toBe(201)
    expect(h.enquiryCreate.mock.calls[0][0].data.formAnswers).toEqual(answers)
  })
})

// ── Phase 3: the same submit, when the trainer has BUILT a flow ─────────────
//
// Everything above runs with no flow steps, and is the proof that the live
// three-screen run did not move. These are the new behaviour, and they are
// deliberately in the same file so the two sit side by side: the only thing
// that differs is whether `commsFlowStep.findMany` comes back empty.
describe('public unified-form submit — a form with a flow on it', () => {
  const flow = (kinds: string[]) =>
    kinds.map((kind, i) => ({ id: `s${i}`, kind, blocking: true, enabled: true, order: i }))

  it('starts a run, tied to the enquiry, for the trainer’s own tenant', async () => {
    h.flowStepFindMany.mockResolvedValue(flow(['MESSAGE', 'FORM']))
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.startEnquiryFlowRun).toHaveBeenCalledWith({
      enquiryId: 'enq-1',
      formId: FORM,
      trainerId: TRAINER,
    })
  })

  it('starts NO run when the trainer has built nothing — the live path', async () => {
    h.flowStepFindMany.mockResolvedValue([])
    await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(h.startEnquiryFlowRun).not.toHaveBeenCalled()
  })

  it('an ACCOUNT step in the flow mints the SAME continuation token', async () => {
    // The generalisation Karl asked for: the account step is now a step of the
    // flow rather than a checkbox. What resumes it is unchanged — the single-use
    // 24h token, which is the enumeration defence (see lib/form-continuation).
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: false })
    h.flowStepFindMany.mockResolvedValue(flow(['ACCOUNT', 'CHOOSE_OFFERING']))

    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    const body = await res.json()

    expect(body.continueUrl).toMatch(new RegExp(`^/form/${FORM}/account\\?t=[0-9a-f]{64}$`))
    const data = h.enquiryCreate.mock.calls[0][0].data
    expect(data.continuationTokenHash).toHaveLength(64)
    expect(data.continuationExpiresAt).toBeInstanceOf(Date)
  })

  it('a flow with no ACCOUNT step mints no token — nothing to resume', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: false })
    h.flowStepFindMany.mockResolvedValue(flow(['MESSAGE', 'APPROVAL']))

    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect((await res.json()).continueUrl).toBeUndefined()
    expect(h.enquiryCreate.mock.calls[0][0].data.continuationTokenHash).toBeUndefined()
    // …but the run still starts: a trainer-actor step reaches the trainer, who
    // exists from the very first moment.
    expect(h.startEnquiryFlowRun).toHaveBeenCalled()
  })

  it('a DISABLED account step is not an account step', async () => {
    h.formFindFirst.mockResolvedValue({ id: FORM, trainerId: TRAINER, questions: QUESTIONS, continueToAccount: false })
    // formJourneySteps filters on enabled server-side, so a paused step never
    // reaches the check — asserted through the query it makes.
    h.flowStepFindMany.mockResolvedValue([])
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect((await res.json()).continueUrl).toBeUndefined()
    expect(h.flowStepFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { formId: FORM, enabled: true } }),
    )
  })

  it('a flow that fails to start still leaves the trainer the enquiry', async () => {
    h.flowStepFindMany.mockResolvedValue(flow(['MESSAGE']))
    h.startEnquiryFlowRun.mockRejectedValue(new Error('boom'))
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.enquiryCreate).toHaveBeenCalled()
    expect(h.notifyEnquiryTrainer).toHaveBeenCalled()
  })
})

// ── A public submission must not tick off somebody else's step ───────────────
//
// A journey can send a client back to a published form of the trainer's, so a
// submission here CAN be the answer a blocking FORM step is waiting for. But
// this endpoint is public and the email in the body is whatever was typed —
// matching a run on it would let a stranger take another person's gate down.
// The session is the only fact about who this is (AGENTS.md bug #6).
describe('answering a flow step from the public form', () => {
  it('records nothing when nobody is signed in', async () => {
    h.auth.mockResolvedValue(null)
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.completeFormFlowSteps).not.toHaveBeenCalled()
  })

  it('records against the SIGNED-IN person, never the typed email', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-9' } })
    await post({ contact: { ...CONTACT, email: 'someone.else@example.com' }, answers: { q1: 'No' } })
    expect(h.completeFormFlowSteps).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-9', formId: FORM, trainerId: TRAINER }),
    )
  })

  it('still returns the enquiry when the tick-off blows up', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-9' } })
    h.completeFormFlowSteps.mockRejectedValue(new Error('boom'))
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.enquiryCreate).toHaveBeenCalled()
  })

  // A session that can't be read is not a signed-in person. It must not become
  // a 500 on a form anyone can reach.
  it('survives a session read that throws', async () => {
    h.auth.mockRejectedValue(new Error('no cookie store'))
    const res = await post({ contact: CONTACT, answers: { q1: 'No' } })
    expect(res.status).toBe(201)
    expect(h.completeFormFlowSteps).not.toHaveBeenCalled()
  })
})
