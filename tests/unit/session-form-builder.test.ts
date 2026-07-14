import { describe, it, expect } from 'vitest'
import {
  addQuestion,
  createCustomFieldQuestion,
  createQuestion,
  duplicateQuestion,
  isChoiceType,
  removeQuestion,
  reorderQuestions,
  serializeQuestions,
  updateQuestion,
  usedCustomFieldIds,
  validateForm,
  type ChoiceQuestion,
  type Question,
} from '@/lib/session-form-builder'

// Pure logic behind the two-pane session form builder modal. The persisted
// question shape must stay exactly what /api/session-forms already accepts.

function q(partial: Partial<Question> & { id: string }): Question {
  return { type: 'SHORT_TEXT', label: 'Q', required: false, ...partial } as Question
}

describe('createQuestion', () => {
  it('makes a blank authored question', () => {
    const created = createQuestion('LONG_TEXT', 'a')
    expect(created).toEqual({ id: 'a', type: 'LONG_TEXT', label: '', required: false })
  })

  it('seeds two blank options for choice types', () => {
    const created = createQuestion('RADIO', 'a')
    expect(created).toMatchObject({ type: 'RADIO', options: ['', ''] })
  })

  it('generates an id when none is given', () => {
    expect(createQuestion('NUMBER').id).toMatch(/^[a-z0-9]+$/)
  })
})

describe('createCustomFieldQuestion', () => {
  it('links to the field and carries no label of its own', () => {
    expect(createCustomFieldQuestion('cf1', 'a')).toEqual({
      id: 'a', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false,
    })
  })
})

describe('isChoiceType', () => {
  it('is true only for option-bearing types', () => {
    expect(['DROPDOWN', 'RADIO', 'CHECKBOX'].every(isChoiceType)).toBe(true)
    expect(['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'RATING_1_5', 'CUSTOM_FIELD'].some(isChoiceType)).toBe(false)
  })
})

describe('addQuestion', () => {
  const base = [q({ id: 'a' }), q({ id: 'b' })]

  it('appends by default and does not mutate the input', () => {
    const next = addQuestion(base, q({ id: 'c' }))
    expect(next.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(base).toHaveLength(2)
  })

  it('inserts at the given index (drop position)', () => {
    expect(addQuestion(base, q({ id: 'c' }), 0).map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(addQuestion(base, q({ id: 'c' }), 1).map(x => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('clamps out-of-range indexes', () => {
    expect(addQuestion(base, q({ id: 'c' }), 99).map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(addQuestion(base, q({ id: 'c' }), -5).map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('removeQuestion', () => {
  it('drops the question, and can empty the form', () => {
    expect(removeQuestion([q({ id: 'a' })], 'a')).toEqual([])
  })

  it('is a no-op for an unknown id', () => {
    expect(removeQuestion([q({ id: 'a' })], 'zz').map(x => x.id)).toEqual(['a'])
  })
})

describe('duplicateQuestion', () => {
  it('inserts the copy directly after the original with a fresh id', () => {
    const list = [q({ id: 'a', label: 'One' }), q({ id: 'b' })]
    const res = duplicateQuestion(list, 'a', 'copy')
    expect(res.newId).toBe('copy')
    expect(res.questions.map(x => x.id)).toEqual(['a', 'copy', 'b'])
    expect(res.questions[1]).toMatchObject({ label: 'One' })
  })

  it('deep-copies the option array so edits do not leak back', () => {
    const list: Question[] = [{ id: 'a', type: 'RADIO', label: 'Pick', required: false, options: ['x'] }]
    const res = duplicateQuestion(list, 'a', 'copy')
    const copy = res.questions[1] as ChoiceQuestion
    copy.options.push('y')
    expect((list[0] as ChoiceQuestion).options).toEqual(['x'])
  })

  it('returns the list untouched for an unknown id', () => {
    const list = [q({ id: 'a' })]
    const res = duplicateQuestion(list, 'zz')
    expect(res.newId).toBeNull()
    expect(res.questions).toBe(list)
  })
})

describe('updateQuestion', () => {
  it('patches only the target question', () => {
    const list = [q({ id: 'a' }), q({ id: 'b' })]
    const next = updateQuestion(list, 'a', { label: 'New', required: true })
    expect(next[0]).toMatchObject({ label: 'New', required: true })
    expect(next[1]).toMatchObject({ label: 'Q', required: false })
  })

  it('seeds options when switching to a choice type', () => {
    const next = updateQuestion([q({ id: 'a' })], 'a', { type: 'CHECKBOX' })
    expect(next[0]).toMatchObject({ type: 'CHECKBOX', options: ['', ''] })
  })

  it('keeps existing options when switching between choice types', () => {
    const list: Question[] = [{ id: 'a', type: 'RADIO', label: 'Pick', required: false, options: ['x', 'y'] }]
    const next = updateQuestion(list, 'a', { type: 'DROPDOWN' })
    expect(next[0]).toMatchObject({ type: 'DROPDOWN', options: ['x', 'y'] })
  })

  it('drops options when switching away from a choice type', () => {
    const list: Question[] = [{ id: 'a', type: 'RADIO', label: 'Pick', required: false, options: ['x'] }]
    const next = updateQuestion(list, 'a', { type: 'SHORT_TEXT' })
    expect(next[0]).not.toHaveProperty('options')
  })

  it('toggles isPrivate', () => {
    const next = updateQuestion([q({ id: 'a' })], 'a', { isPrivate: true })
    expect(next[0].isPrivate).toBe(true)
  })
})

describe('reorderQuestions', () => {
  const list = [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c' })]

  it('moves the dragged question to the target slot', () => {
    expect(reorderQuestions(list, 'c', 'a').map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(reorderQuestions(list, 'a', 'c').map(x => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op when the ids match or are unknown', () => {
    expect(reorderQuestions(list, 'a', 'a')).toBe(list)
    expect(reorderQuestions(list, 'a', 'zz')).toBe(list)
  })
})

describe('usedCustomFieldIds', () => {
  it('collects only linked-field questions', () => {
    const list = [q({ id: 'a' }), createCustomFieldQuestion('cf1', 'b'), createCustomFieldQuestion('cf2', 'c')]
    expect([...usedCustomFieldIds(list)].sort()).toEqual(['cf1', 'cf2'])
  })
})

describe('validateForm', () => {
  it('requires a name', () => {
    expect(validateForm('  ', [q({ id: 'a' })])).toMatch(/name/i)
  })

  it('requires at least one question', () => {
    expect(validateForm('Report', [])).toMatch(/at least one question/i)
  })

  it('requires every authored question to have a label', () => {
    expect(validateForm('Report', [q({ id: 'a', label: '   ' })])).toMatch(/label/i)
  })

  it('requires a choice question to have at least one non-blank option', () => {
    const list: Question[] = [{ id: 'a', type: 'DROPDOWN', label: 'Mood', required: false, options: ['', ' '] }]
    expect(validateForm('Report', list)).toMatch(/needs at least one option/i)
  })

  it('does not demand a label for linked fields', () => {
    expect(validateForm('Report', [createCustomFieldQuestion('cf1', 'a')])).toBeNull()
  })

  it('passes a well-formed form', () => {
    const list: Question[] = [
      { id: 'a', type: 'LONG_TEXT', label: 'How did it go?', required: true },
      { id: 'b', type: 'RADIO', label: 'Mood', required: false, options: ['Good', 'Bad'] },
      createCustomFieldQuestion('cf1', 'c'),
    ]
    expect(validateForm('Session report', list)).toBeNull()
  })
})

describe('serializeQuestions', () => {
  it('trims labels, drops blank options, and normalises isPrivate', () => {
    const list: Question[] = [
      { id: 'a', type: 'SHORT_TEXT', label: '  Name  ', required: true },
      { id: 'b', type: 'CHECKBOX', label: ' Skills ', required: false, options: [' Sit ', '', 'Stay'] },
      { id: 'c', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false, isPrivate: true },
    ]
    expect(serializeQuestions(list)).toEqual([
      { id: 'a', type: 'SHORT_TEXT', label: 'Name', required: true, isPrivate: false },
      { id: 'b', type: 'CHECKBOX', label: 'Skills', required: false, isPrivate: false, options: ['Sit', 'Stay'] },
      { id: 'c', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false, isPrivate: true },
    ])
  })
})
