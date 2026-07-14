// Pure logic for the session form builder (the two-pane modal on
// Settings → Fields & forms → Forms → "New session form").
//
// Everything here is a pure function over the Question[] the builder edits, so
// it can be unit-tested without React: add / duplicate / remove / reorder /
// update, plus the validation + serialisation the save call needs.
//
// The persisted question shape is unchanged — /api/session-forms still receives
// exactly what the old page editor sent.

export type BasicType = 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
export type ChoiceType = 'DROPDOWN' | 'RADIO' | 'CHECKBOX'
export type QuestionType = BasicType | ChoiceType | 'CUSTOM_FIELD'

export interface BasicQuestion { id: string; type: BasicType; label: string; required: boolean; isPrivate?: boolean }
/** Dropdown / radio / checkbox — the only questions that carry an option list. */
export interface ChoiceQuestion { id: string; type: ChoiceType; label: string; required: boolean; isPrivate?: boolean; options: string[] }
export interface LinkedQuestion { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean; isPrivate?: boolean }

export type Question = BasicQuestion | ChoiceQuestion | LinkedQuestion

/** Narrows a Question to one that owns an `options` array. */
export function hasOptions(q: Question): q is ChoiceQuestion {
  return q.type !== 'CUSTOM_FIELD' && isChoiceType(q.type)
}

/** A question the trainer authored (i.e. not linked to a CustomField). */
export type AuthoredQuestion = BasicQuestion | ChoiceQuestion

export interface CustomFieldOption {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
}

const CHOICE_TYPES: ChoiceType[] = ['DROPDOWN', 'RADIO', 'CHECKBOX']

export function isChoiceType(t: string): t is ChoiceType {
  return (CHOICE_TYPES as string[]).includes(t)
}

export const TYPE_LABELS: Record<Exclude<QuestionType, 'CUSTOM_FIELD'>, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  RATING_1_5: 'Rating 1–5',
  DROPDOWN: 'Dropdown',
  RADIO: 'Radio',
  CHECKBOX: 'Checkbox',
}

/** Palette order for the "New question" group. */
export const NEW_QUESTION_TYPES: Exclude<QuestionType, 'CUSTOM_FIELD'>[] = [
  'SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'RATING_1_5', 'DROPDOWN', 'RADIO', 'CHECKBOX',
]

export function newQuestionId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** A blank question of `type`. Choice types get two empty options to edit. */
export function createQuestion(
  type: Exclude<QuestionType, 'CUSTOM_FIELD'>,
  id: string = newQuestionId(),
): Question {
  if (isChoiceType(type)) {
    return { id, type, label: '', required: false, options: ['', ''] }
  }
  return { id, type: type as BasicType, label: '', required: false }
}

/** A question linked to one of the trainer's existing CustomFields. */
export function createCustomFieldQuestion(
  customFieldId: string,
  id: string = newQuestionId(),
): Question {
  return { id, type: 'CUSTOM_FIELD', customFieldId, required: false }
}

/** Insert `q` at `index` (default: append). Out-of-range indexes clamp. */
export function addQuestion(questions: Question[], q: Question, index?: number): Question[] {
  const next = questions.slice()
  const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length))
  next.splice(at, 0, q)
  return next
}

export function removeQuestion(questions: Question[], id: string): Question[] {
  return questions.filter(q => q.id !== id)
}

/** Copy the question after itself. Returns the list plus the new id (null if not found). */
export function duplicateQuestion(
  questions: Question[],
  id: string,
  newId: string = newQuestionId(),
): { questions: Question[]; newId: string | null } {
  const idx = questions.findIndex(q => q.id === id)
  if (idx === -1) return { questions, newId: null }
  const source = questions[idx]
  const copy = {
    ...source,
    id: newId,
    ...('options' in source ? { options: source.options.slice() } : {}),
  } as Question
  return { questions: addQuestion(questions, copy, idx + 1), newId }
}

/**
 * Patch a question. Switching an authored question to a choice type seeds two
 * blank options; switching away drops them, so the saved shape stays valid.
 */
export function updateQuestion(
  questions: Question[],
  id: string,
  patch: Partial<AuthoredQuestion> & { customFieldId?: string },
): Question[] {
  return questions.map(q => {
    if (q.id !== id) return q
    const merged = { ...q, ...patch } as Question
    if (patch.type && patch.type !== q.type) {
      if (isChoiceType(patch.type)) {
        const existing = 'options' in q ? q.options : undefined
        ;(merged as Extract<Question, { type: ChoiceType }>).options =
          existing && existing.length > 0 ? existing : ['', '']
      } else if ('options' in merged) {
        delete (merged as { options?: string[] }).options
      }
    }
    return merged
  })
}

/** Move the question with id `activeId` to where `overId` currently sits. */
export function reorderQuestions(questions: Question[], activeId: string, overId: string): Question[] {
  const from = questions.findIndex(q => q.id === activeId)
  const to = questions.findIndex(q => q.id === overId)
  if (from === -1 || to === -1 || from === to) return questions
  const next = questions.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** CustomField ids already on the form — the palette dims these ("Added"). */
export function usedCustomFieldIds(questions: Question[]): Set<string> {
  return new Set(
    questions.filter(q => q.type === 'CUSTOM_FIELD').map(q => (q as { customFieldId: string }).customFieldId)
  )
}

/** null when the form can be saved, otherwise the first problem to show. */
export function validateForm(name: string, questions: Question[]): string | null {
  if (!name.trim()) return 'Give the form a name'
  if (questions.length === 0) return 'Add at least one question'
  for (const q of questions) {
    if (q.type === 'CUSTOM_FIELD') {
      if (!q.customFieldId) return 'A linked field question is missing its field'
      continue
    }
    if (!q.label.trim()) return 'Every question needs a label'
    if (hasOptions(q)) {
      const opts = q.options.map(o => o.trim()).filter(Boolean)
      if (opts.length === 0) return `"${q.label.trim()}" needs at least one option`
    }
  }
  return null
}

/** Trim labels/options for the POST/PATCH body. Shape matches the existing API. */
export function serializeQuestions(questions: Question[]): Question[] {
  return questions.map(q => {
    if (q.type === 'CUSTOM_FIELD') {
      return { id: q.id, type: q.type, customFieldId: q.customFieldId, required: q.required, isPrivate: !!q.isPrivate }
    }
    if (hasOptions(q)) {
      return {
        id: q.id,
        type: q.type,
        label: q.label.trim(),
        required: q.required,
        isPrivate: !!q.isPrivate,
        options: q.options.map(o => o.trim()).filter(Boolean),
      }
    }
    return { id: q.id, type: q.type, label: q.label.trim(), required: q.required, isPrivate: !!q.isPrivate }
  })
}
