import { describe, it, expect, vi, beforeEach } from 'vitest'

// A client may only ever submit the form THEIR trainer assigned to THEM.
// Without that check, any signed-in client could POST another trainer's form
// id and stamp themselves past the gate.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  clientUpdate: vi.fn(),
  formFindFirst: vi.fn(),
  customFieldFindMany: vi.fn(),
  valueFindFirst: vi.fn(),
  valueCreate: vi.fn(),
  valueUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique, update: h.clientUpdate },
    form: { findFirst: h.formFindFirst },
    customField: { findMany: h.customFieldFindMany },
    customFieldValue: { findFirst: h.valueFindFirst, create: h.valueCreate, update: h.valueUpdate },
  },
}))

import { POST } from '@/app/api/my/intake-form/submit/route'

const CLIENT = 'client-1'
const TRAINER = 'trainer-1'
const FORM = 'form-1'

function post(body: unknown) {
  return POST(new Request('https://app.pupmanager.com/api/my/intake-form/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { role: 'CLIENT' } })
  h.getActiveClient.mockResolvedValue({ clientId: CLIENT })
  h.clientFindUnique.mockResolvedValue({ id: CLIENT, trainerId: TRAINER, intakeFormId: FORM })
  h.formFindFirst.mockResolvedValue({ questions: [] })
  h.customFieldFindMany.mockResolvedValue([])
  h.valueFindFirst.mockResolvedValue(null)
  h.clientUpdate.mockResolvedValue({ id: CLIENT })
})

describe('POST /api/my/intake-form/submit — guards', () => {
  it('rejects a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    expect((await post({ formId: FORM, answers: {} })).status).toBe(401)
    expect(h.clientUpdate).not.toHaveBeenCalled()
  })

  it('rejects a TRAINER session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER } })
    expect((await post({ formId: FORM, answers: {} })).status).toBe(401)
  })

  it('refuses a form that is not the one assigned to this client', async () => {
    const res = await post({ formId: 'someone-elses-form', answers: {} })
    expect(res.status).toBe(403)
    expect(h.clientUpdate).not.toHaveBeenCalled()
  })

  it("looks the form up scoped to the client's own trainer", async () => {
    await post({ formId: FORM, answers: {} })
    expect(h.formFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: FORM, trainerId: TRAINER }) }),
    )
  })
})

describe('POST /api/my/intake-form/submit — writes', () => {
  it('lifts the gate and stores the answers', async () => {
    const answers = { q1: 'Yes', q2: ['a', 'b'] }
    expect((await post({ formId: FORM, answers })).status).toBe(200)
    const arg = h.clientUpdate.mock.calls[0][0]
    expect(arg.where).toEqual({ id: CLIENT })
    expect(arg.data.intakeAnswers).toEqual(answers)
    expect(arg.data.intakeCompletedAt).toBeInstanceOf(Date)
  })

  it('mirrors a linked answer into the trainer-owned CustomField', async () => {
    h.formFindFirst.mockResolvedValue({
      questions: [{ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false }],
    })
    h.customFieldFindMany.mockResolvedValue([{ id: 'cf1' }])
    await post({ formId: FORM, answers: { q1: 'Anxious around bikes' } })
    expect(h.valueCreate).toHaveBeenCalledWith({
      data: { fieldId: 'cf1', clientId: CLIENT, value: 'Anxious around bikes' },
    })
  })

  it('joins a checkbox answer rather than writing "[object Object]"', async () => {
    h.formFindFirst.mockResolvedValue({
      questions: [{ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false }],
    })
    h.customFieldFindMany.mockResolvedValue([{ id: 'cf1' }])
    await post({ formId: FORM, answers: { q1: ['Reactivity', 'Anxiety'] } })
    expect(h.valueCreate).toHaveBeenCalledWith({
      data: { fieldId: 'cf1', clientId: CLIENT, value: 'Reactivity, Anxiety' },
    })
  })

  it('skips a linked question pointing at a field the trainer does not own', async () => {
    h.formFindFirst.mockResolvedValue({
      questions: [{ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'not-theirs', required: false }],
    })
    h.customFieldFindMany.mockResolvedValue([]) // owns nothing
    await post({ formId: FORM, answers: { q1: 'leaked?' } })
    expect(h.valueCreate).not.toHaveBeenCalled()
    expect(h.valueUpdate).not.toHaveBeenCalled()
    // …but the client is still let through; a bad question must not trap them.
    expect(h.clientUpdate).toHaveBeenCalled()
  })
})
