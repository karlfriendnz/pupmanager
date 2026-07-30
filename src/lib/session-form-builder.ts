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
export type QuestionType = BasicType | ChoiceType | 'CUSTOM_FIELD' | 'CLIENT_FIELD'

/**
 * Conditional visibility: show this question only when the referenced
 * question's answer equals `equals` (for a checkbox answer, when it *contains*
 * `equals`). Only used by the unified Form renderers today — session forms are
 * filled in by the trainer and show every question.
 */
export interface ShowIf { questionId: string; equals: string }

/** One page of a multi-step form. An empty step list = a single-page form. */
export interface FormStep { id: string; title: string }

export interface BasicQuestion { id: string; type: BasicType; label: string; required: boolean; isPrivate?: boolean; showIf?: ShowIf; step?: string }
/** Dropdown / radio / checkbox — the only questions that carry an option list. */
export interface ChoiceQuestion { id: string; type: ChoiceType; label: string; required: boolean; isPrivate?: boolean; options: string[]; showIf?: ShowIf; step?: string }
/**
 * A question whose answer is kept on the client's record, not just in this form's
 * answers — so it reaches their profile, the clients-list sorting and the reports.
 *
 * `customFieldId` is absent only for a field being CREATED right here in the
 * builder: `field` carries what to make, the server writes it, and the saved
 * question comes back as a bare link (see persistLinkedFields in form-api). Both
 * present = editing that field in place.
 */
export interface NewFieldSpec {
  label: string
  /** The question's own answer type; the stored field type is derived from it. */
  answerType: Exclude<QuestionType, 'CUSTOM_FIELD'>
  options?: string[]
  appliesTo: 'OWNER' | 'DOG'
  category?: string | null
}
export interface LinkedQuestion { id: string; type: 'CUSTOM_FIELD'; customFieldId?: string; required: boolean; isPrivate?: boolean; showIf?: ShowIf; step?: string; field?: NewFieldSpec }

/**
 * A question that asks for one of the BUILT-IN client/dog details — their name,
 * email, phone, address, or the dog's name, breed, weight, birthday, notes.
 *
 * These back real columns on User / ClientProfile / Dog, so they were configured
 * apart from forms: a separate screen decided which were required and in what
 * order. But "the system fields are just a result of the forms" (Karl,
 * 2026-07-30) — if the form asks for an email and marks it required, that IS the
 * rule. So they become questions like everything else, and the form is the one
 * place that says what a client is asked for.
 *
 * The answer is written to the real column, never into the form's answer blob —
 * a name collected here has to BE the client's name.
 */
export interface ClientFieldQuestion {
  id: string
  type: 'CLIENT_FIELD'
  /** Which built-in detail (a ClientFieldKey — see lib/client-fields). */
  fieldKey: string
  required: boolean
  isPrivate?: boolean
  showIf?: ShowIf
  step?: string
}

export type Question = BasicQuestion | ChoiceQuestion | LinkedQuestion | ClientFieldQuestion

/** Narrows a Question to one that owns an `options` array. */
export function hasOptions(q: Question): q is ChoiceQuestion {
  return q.type !== 'CUSTOM_FIELD' && q.type !== 'CLIENT_FIELD' && isChoiceType(q.type)
}

/** A question the trainer authored — the ones that carry their own label text. */
export type AuthoredQuestion = BasicQuestion | ChoiceQuestion

/**
 * Does this question carry its own label?
 *
 * Two kinds don't: a CUSTOM_FIELD is named by the field it links to, and a
 * CLIENT_FIELD by the built-in detail it asks for. Callers used to test
 * `type !== 'CUSTOM_FIELD'` and read `.label`, which silently became wrong the
 * moment a second labelless kind existed — so the question answers it instead.
 */
export function hasLabel(q: Question): q is AuthoredQuestion {
  return q.type !== 'CUSTOM_FIELD' && q.type !== 'CLIENT_FIELD'
}

export interface CustomFieldOption {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
  /** Choices, for a DROPDOWN field. Needed so the builder can EDIT a linked
   *  field's options rather than only display its name. */
  options?: string[]
}

const CHOICE_TYPES: ChoiceType[] = ['DROPDOWN', 'RADIO', 'CHECKBOX']

export function isChoiceType(t: string): t is ChoiceType {
  return (CHOICE_TYPES as string[]).includes(t)
}

export const TYPE_LABELS: Record<Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'>, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  RATING_1_5: 'Rating 1–5',
  DROPDOWN: 'Dropdown',
  RADIO: 'Radio',
  CHECKBOX: 'Checkbox',
}

/** Palette order for the "New question" group. */
/**
 * The answer types a SAVED-to-record question may use.
 *
 * Only three, because a saved question is stored as a bare link and rendered from
 * the field's own type — so a rating or radio group would silently come out as a
 * number or a dropdown. Offering a choice the client never sees is worse than not
 * offering it.
 */
export const SAVED_FIELD_TYPES: Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'>[] = ['SHORT_TEXT', 'NUMBER', 'DROPDOWN']

export const NEW_QUESTION_TYPES: Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'>[] = [
  'SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'RATING_1_5', 'DROPDOWN', 'RADIO', 'CHECKBOX',
]

export function newQuestionId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** A blank question of `type`. Choice types get two empty options to edit. */
export function createQuestion(
  type: Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'>,
  id: string = newQuestionId(),
): Question {
  if (isChoiceType(type)) {
    return { id, type, label: '', required: false, options: ['', ''] }
  }
  return { id, type: type as BasicType, label: '', required: false }
}

/** A question asking for one of the built-in client/dog details. */
export function createClientFieldQuestion(
  fieldKey: string,
  id: string = newQuestionId(),
  required = false,
): Question {
  return { id, type: 'CLIENT_FIELD', fieldKey, required }
}

/** A question linked to one of the trainer's existing CustomFields. */
export function createCustomFieldQuestion(
  customFieldId: string,
  id: string = newQuestionId(),
): Question {
  return { id, type: 'CUSTOM_FIELD', customFieldId, required: false }
}

/**
 * A brand-new client field, authored right here.
 *
 * The point of the whole exercise: making a field used to mean leaving the
 * builder for another screen, creating it, coming back and linking it. The field
 * itself is written when the FORM is saved, so abandoning a half-built form leaves
 * nothing behind.
 */
export function createFieldQuestion(id: string = newQuestionId()): Question {
  return {
    id,
    type: 'CUSTOM_FIELD',
    required: false,
    field: { label: '', answerType: 'SHORT_TEXT', appliesTo: 'OWNER' },
  }
}

/** The definition to show for a linked question — the one being authored, or the
 *  linked field's own, so an existing link is editable rather than read-only. */
export function fieldSpecFor(q: LinkedQuestion, fields: CustomFieldOption[]): NewFieldSpec | null {
  if (q.field) return q.field
  const linked = fields.find(f => f.id === q.customFieldId)
  if (!linked) return null
  return {
    label: linked.label,
    // Widen the three stored types back to a question type. A stored DROPDOWN
    // could have been authored as radio or tick-boxes; the list is what matters
    // and the trainer can change the presentation.
    answerType: linked.type === 'NUMBER' ? 'NUMBER' : linked.type === 'DROPDOWN' ? 'DROPDOWN' : 'SHORT_TEXT',
    options: linked.options ?? [],
    appliesTo: linked.appliesTo,
    category: linked.category,
  }
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
 * Deep-copy every question with fresh ids, remapping `showIf` references so the
 * copy's conditional logic points within itself rather than back at the
 * original. Powers "Duplicate form".
 */
export function duplicateForm(questions: Question[]): Question[] {
  const idMap = new Map<string, string>()
  for (const q of questions) idMap.set(q.id, newQuestionId())
  return questions.map(q => {
    const copy = {
      ...q,
      id: idMap.get(q.id)!,
      ...('options' in q ? { options: q.options.slice() } : {}),
    } as Question
    if (q.showIf) {
      copy.showIf = { ...q.showIf, questionId: idMap.get(q.showIf.questionId) ?? q.showIf.questionId }
    }
    return copy
  })
}

/**
 * Whether a question should render, given the answers so far. A question with
 * no `showIf` is always visible; otherwise it shows when the referenced answer
 * matches (a checkbox answer matches when it contains the value).
 */
export function isQuestionVisible(
  q: Question,
  answers: Record<string, string | string[] | undefined>,
): boolean {
  if (!q.showIf) return true
  const v = answers[q.showIf.questionId]
  if (Array.isArray(v)) return v.includes(q.showIf.equals)
  return v === q.showIf.equals
}

/**
 * Patch a question. Switching an authored question to a choice type seeds two
 * blank options; switching away drops them, so the saved shape stays valid.
 */
export function updateQuestion(
  questions: Question[],
  id: string,
  // `field` is the definition of a saved-to-record question being authored here —
  // see NewFieldSpec. It rides along with the ordinary label/type/options patches
  // so one editor can drive both kinds of question.
  patch: Partial<AuthoredQuestion> & { customFieldId?: string; field?: NewFieldSpec },
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
      // A field being authored HERE has no id yet — its definition is what gets
      // checked, and the server writes the field on save.
      if (q.field) {
        if (!q.field.label.trim()) return 'Every question needs a label'
        if (isChoiceType(q.field.answerType)) {
          const opts = (q.field.options ?? []).map(o => o.trim()).filter(Boolean)
          if (opts.length === 0) return `"${q.field.label.trim()}" needs at least one option`
        }
        continue
      }
      if (!q.customFieldId) return 'A linked field question is missing its field'
      continue
    }
    // Named by the built-in detail it asks for — nothing for a trainer to fill in
    // and so nothing to get wrong.
    if (q.type === 'CLIENT_FIELD') {
      if (!q.fieldKey) return 'A client-detail question is missing which detail it asks for'
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
    // Only emit showIf / step when set, so a session form's payload is byte-for
    // byte what /api/session-forms has always received.
    const extra = {
      ...(q.showIf ? { showIf: q.showIf } : {}),
      ...(q.step ? { step: q.step } : {}),
    }
    if (q.type === 'CUSTOM_FIELD') {
      return {
        id: q.id,
        type: q.type,
        // Omitted entirely when absent: sending `customFieldId: undefined` would
        // fail the API's min(1) check on a field being created here.
        ...(q.customFieldId ? { customFieldId: q.customFieldId } : {}),
        // The definition rides along so the server can write the field. Trimmed
        // and emptied of blank options the same way an authored question is.
        ...(q.field
          ? {
              field: {
                ...q.field,
                label: q.field.label.trim(),
                ...(q.field.options
                  ? { options: q.field.options.map(o => o.trim()).filter(Boolean) }
                  : {}),
              },
            }
          : {}),
        required: q.required,
        isPrivate: !!q.isPrivate,
        ...extra,
      }
    }
    if (q.type === 'CLIENT_FIELD') {
      return { id: q.id, type: q.type, fieldKey: q.fieldKey, required: q.required, isPrivate: !!q.isPrivate, ...extra }
    }
    if (hasOptions(q)) {
      return {
        id: q.id,
        type: q.type,
        label: q.label.trim(),
        required: q.required,
        isPrivate: !!q.isPrivate,
        options: q.options.map(o => o.trim()).filter(Boolean),
        ...extra,
      }
    }
    return { id: q.id, type: q.type, label: q.label.trim(), required: q.required, isPrivate: !!q.isPrivate, ...extra }
  })
}
