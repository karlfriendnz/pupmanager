import { describe, it, expect, vi, beforeEach } from 'vitest'

// The builder becomes the one place a client field is made: a question can carry
// the field's definition, and the server creates or edits the real CustomField.
// Prisma is mocked — unit tests never touch a real DB (AGENTS.md).

const db = vi.hoisted(() => ({
  customField: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { persistLinkedFields, customFieldTypeFor, questionSchema } = await import('@/lib/form-api')

type Q = Parameters<typeof persistLinkedFields>[0][number]

beforeEach(() => {
  vi.clearAllMocks()
  db.customField.findMany.mockResolvedValue([])
  db.customField.create.mockImplementation(({ data }: { data: { label: string } }) =>
    Promise.resolve({ id: 'new-field-id', ...data }))
  db.customField.update.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({ id: where.id }))
})

describe('how an answer type is filed', () => {
  // The extra types are presentation: a rating is a number, radios and tick-boxes
  // are a list of choices. Storing them as themselves would need three new
  // CustomFieldType values for no gain.
  it('maps the seven builder types onto the three stored ones', () => {
    expect(customFieldTypeFor('SHORT_TEXT')).toBe('TEXT')
    expect(customFieldTypeFor('LONG_TEXT')).toBe('TEXT')
    expect(customFieldTypeFor('NUMBER')).toBe('NUMBER')
    expect(customFieldTypeFor('RATING_1_5')).toBe('NUMBER')
    expect(customFieldTypeFor('DROPDOWN')).toBe('DROPDOWN')
    expect(customFieldTypeFor('RADIO')).toBe('DROPDOWN')
    expect(customFieldTypeFor('CHECKBOX')).toBe('DROPDOWN')
  })

  it('files anything unrecognised as text rather than throwing', () => {
    expect(customFieldTypeFor('SOMETHING_NEW')).toBe('TEXT')
  })
})

describe('a linked question must name a field or bring one', () => {
  it('accepts a question that creates its field', () => {
    const parsed = questionSchema.safeParse({
      id: 'q1', type: 'CUSTOM_FIELD', required: true,
      field: { label: 'Vet name', answerType: 'SHORT_TEXT', appliesTo: 'DOG' },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a question that links an existing field', () => {
    expect(questionSchema.safeParse({ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'f1' }).success).toBe(true)
  })

  // Neither means a question that claims to save to the record with nowhere to
  // save it — it would render as "Unknown field" forever.
  it('rejects a question with neither', () => {
    expect(questionSchema.safeParse({ id: 'q1', type: 'CUSTOM_FIELD' }).success).toBe(false)
  })
})

describe('saving a form writes the fields it authored', () => {
  it('creates a field for a question that brought one, and links it', async () => {
    const questions: Q[] = [{
      id: 'q1', type: 'CUSTOM_FIELD', required: true,
      field: { label: 'Vet name', answerType: 'SHORT_TEXT', appliesTo: 'DOG', category: 'Health' },
    } as Q]

    const res = await persistLinkedFields(questions, 'trainer-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(db.customField.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trainerId: 'trainer-1',
        label: 'Vet name',
        type: 'TEXT',
        appliesTo: 'DOG',
        category: 'Health',
        required: true,
      }),
    })
    // Stored as a BARE link: the CustomField is the single definition, so the
    // question must not keep a second copy that can drift.
    expect(res.questions[0]).toEqual({
      id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'new-field-id', required: true,
    })
  })

  it('edits the field in place when the question already links one', async () => {
    db.customField.findMany.mockResolvedValue([{ id: 'f1' }])
    const questions: Q[] = [{
      id: 'q1', type: 'CUSTOM_FIELD', required: false, customFieldId: 'f1',
      field: { label: 'Renamed', answerType: 'DROPDOWN', options: ['a', 'b'], appliesTo: 'OWNER' },
    } as Q]

    const res = await persistLinkedFields(questions, 'trainer-1')
    expect(res.ok).toBe(true)
    expect(db.customField.create).not.toHaveBeenCalled()
    expect(db.customField.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ label: 'Renamed', type: 'DROPDOWN', options: ['a', 'b'] }),
    })
  })

  // The id arrives from a browser. Trusting it would let one trainer rename
  // another's field out from under them.
  it('refuses to touch a field this trainer doesn’t own', async () => {
    db.customField.findMany.mockResolvedValue([])
    const res = await persistLinkedFields(
      [{ id: 'q1', type: 'CUSTOM_FIELD', required: false, customFieldId: 'someone-elses' } as Q],
      'trainer-1',
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.missing).toEqual(['someone-elses'])
    expect(db.customField.update).not.toHaveBeenCalled()
  })

  it('leaves ordinary questions alone and writes nothing for them', async () => {
    const questions: Q[] = [{ id: 'q1', type: 'SHORT_TEXT', label: 'Your name', required: false } as Q]
    const res = await persistLinkedFields(questions, 'trainer-1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.questions).toEqual(questions)
    expect(db.customField.create).not.toHaveBeenCalled()
    expect(db.customField.findMany).not.toHaveBeenCalled()
  })

  // A field's order drives how it's listed on the profile and in the clients-list
  // filters, so it follows where the trainer put the question.
  it('orders fields by their position in the form', async () => {
    const questions: Q[] = [
      { id: 'q1', type: 'SHORT_TEXT', label: 'Name', required: false } as Q,
      { id: 'q2', type: 'CUSTOM_FIELD', required: false, field: { label: 'Second', answerType: 'SHORT_TEXT', appliesTo: 'OWNER' } } as Q,
    ]
    await persistLinkedFields(questions, 'trainer-1')
    expect(db.customField.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order: 1 }),
    })
  })

  // A choice field with no options would render an empty dropdown.
  it('stores no empty options list', async () => {
    await persistLinkedFields(
      [{ id: 'q1', type: 'CUSTOM_FIELD', required: false, field: { label: 'Text', answerType: 'SHORT_TEXT', appliesTo: 'OWNER', options: [] } } as Q],
      'trainer-1',
    )
    const arg = db.customField.create.mock.calls[0][0] as { data: { options?: unknown } }
    expect(arg.data.options).toBeUndefined()
  })
})
