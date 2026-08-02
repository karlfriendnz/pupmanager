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
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    embedForm: { findFirst: h.embedFindFirst },
    form: { findFirst: h.formFindFirst },
    customField: { findMany: h.customFieldFindMany },
    enquiry: { create: h.enquiryCreate },
  },
}))
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
