import { describe, it, expect } from 'vitest'
import {
  duplicateForm, isQuestionVisible, serializeQuestions,
  type Question,
} from '@/lib/session-form-builder'

// The conditional-visibility + whole-form-duplicate half of the shared question
// engine. Only the unified Form renderers use `showIf` / `step` today; session
// forms are trainer-filled and show everything, so these tests also pin that a
// session form's serialised payload is unchanged when neither is set.

const base: Question[] = [
  { id: 'a', type: 'DROPDOWN', label: 'Has your dog been groomed before?', required: true, options: ['Yes', 'No'] },
  { id: 'b', type: 'SHORT_TEXT', label: 'When was the last groom?', required: false, showIf: { questionId: 'a', equals: 'Yes' } },
]

describe('isQuestionVisible', () => {
  it('shows a question with no condition', () => {
    expect(isQuestionVisible(base[0], {})).toBe(true)
  })

  it('hides a conditional question until its trigger matches', () => {
    expect(isQuestionVisible(base[1], {})).toBe(false)
    expect(isQuestionVisible(base[1], { a: 'No' })).toBe(false)
    expect(isQuestionVisible(base[1], { a: 'Yes' })).toBe(true)
  })

  it('matches when a checkbox answer contains the value', () => {
    const q: Question = { id: 'c', type: 'SHORT_TEXT', label: 'x', required: false, showIf: { questionId: 'm', equals: 'Anxiety' } }
    expect(isQuestionVisible(q, { m: ['Reactivity', 'Anxiety'] })).toBe(true)
    expect(isQuestionVisible(q, { m: ['Reactivity'] })).toBe(false)
    expect(isQuestionVisible(q, { m: [] })).toBe(false)
  })
})

describe('duplicateForm', () => {
  it('gives every question a fresh id', () => {
    const copy = duplicateForm(base)
    expect(copy.map(q => q.id)).not.toEqual(base.map(q => q.id))
    expect(new Set(copy.map(q => q.id)).size).toBe(copy.length)
  })

  it('rewires showIf references to the copied ids', () => {
    const copy = duplicateForm(base)
    expect(copy[1].showIf?.questionId).toBe(copy[0].id)
    expect(copy[1].showIf?.equals).toBe('Yes')
    // …and crucially NOT back at the original, which would make editing the
    // copy's trigger silently do nothing.
    expect(copy[1].showIf?.questionId).not.toBe('a')
  })

  it('deep-copies options so edits to the copy do not leak back', () => {
    const copy = duplicateForm(base)
    ;(copy[0] as { options: string[] }).options.push('Maybe')
    expect((base[0] as { options: string[] }).options).toEqual(['Yes', 'No'])
  })

  it('carries the step assignment across', () => {
    const stepped: Question[] = [{ id: 'a', type: 'SHORT_TEXT', label: 'x', required: false, step: 's1' }]
    expect(duplicateForm(stepped)[0].step).toBe('s1')
  })
})

describe('serializeQuestions', () => {
  it('preserves showIf and step when set', () => {
    const out = serializeQuestions([
      ...base,
      { id: 'c', type: 'SHORT_TEXT', label: 'On page two', required: false, step: 's2' },
    ])
    expect(out[1].showIf).toEqual({ questionId: 'a', equals: 'Yes' })
    expect(out[2].step).toBe('s2')
  })

  it('omits them entirely when unset, so a session form payload is unchanged', () => {
    const out = serializeQuestions([base[0]])
    expect(out[0]).toEqual({
      id: 'a', type: 'DROPDOWN', label: 'Has your dog been groomed before?',
      required: true, isPrivate: false, options: ['Yes', 'No'],
    })
    expect('showIf' in out[0]).toBe(false)
    expect('step' in out[0]).toBe(false)
  })
})
