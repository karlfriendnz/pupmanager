/**
 * Turning the two OLD form models into real forms.
 *
 * Both conversions exist because a trainer's questions used to live in three
 * places at once (Karl, 2026-08-06: "that should be an intake form", and "all
 * forms should be the same right?"). The risky parts are not the database
 * writes — they are the decisions: which page a question lands on, and what
 * happens to a key the live form stopped rendering years ago. Those are pure,
 * so they are tested here without a database.
 *
 * The route-level tenant guards are in tests/unit/security/form-conversion-routes.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { buildIntakeFormFromFields, buildEnquiryFormFromEmbed } from '@/lib/form-api'
import { fieldSpecFor } from '@/lib/session-form-builder'
import type { LinkedQuestion } from '@/lib/session-form-builder'

describe('buildIntakeFormFromFields', () => {
  it('links each question to the field that already exists, rather than copying it', () => {
    const { questions } = buildIntakeFormFromFields([
      { id: 'f1', required: true, appliesTo: 'OWNER' },
      { id: 'f2', required: false, appliesTo: 'OWNER' },
    ])
    // The whole point of the conversion: answers keep landing on the same field,
    // so nothing already collected moves and nobody is asked twice. A question
    // carrying its own label would be a SECOND definition of the field.
    expect(questions).toEqual([
      { id: 'q_f1', type: 'CUSTOM_FIELD', customFieldId: 'f1', required: true },
      { id: 'q_f2', type: 'CUSTOM_FIELD', customFieldId: 'f2', required: false },
    ])
    expect(questions.every(q => !('label' in q))).toBe(true)
  })

  it('splits owner and dog questions onto two pages, in that reading order', () => {
    const { questions, steps } = buildIntakeFormFromFields([
      { id: 'd1', required: false, appliesTo: 'DOG' },
      { id: 'o1', required: true, appliesTo: 'OWNER' },
    ])
    expect(steps).toEqual([
      { id: 'owner', title: 'About you' },
      { id: 'dog', title: 'About your dog' },
    ])
    // Owner first even though the dog field came first in the list — the old
    // gate asked about the person before the dog.
    expect(questions.map(q => q.id)).toEqual(['q_o1', 'q_d1'])
    expect(questions.map(q => (q as { step?: string }).step)).toEqual(['owner', 'dog'])
  })

  it('makes no pages at all when every field is about the owner', () => {
    const { questions, steps } = buildIntakeFormFromFields([
      { id: 'o1', required: true, appliesTo: 'OWNER' },
      { id: 'o2', required: false, appliesTo: null },
    ])
    // A single page is not a wizard. An "About you" step on its own is a page a
    // client taps Next through for no reason.
    expect(steps).toEqual([])
    expect(questions.every(q => !('step' in q))).toBe(true)
  })

  it('makes no pages when every field is about the dog either', () => {
    const { steps } = buildIntakeFormFromFields([{ id: 'd1', required: false, appliesTo: 'DOG' }])
    expect(steps).toEqual([])
  })

  it('treats a field with no appliesTo as the owner’s, not the dog’s', () => {
    const { questions } = buildIntakeFormFromFields([
      { id: 'x', required: false, appliesTo: null },
      { id: 'd', required: false, appliesTo: 'DOG' },
    ])
    expect(questions.map(q => (q as { step?: string }).step)).toEqual(['owner', 'dog'])
  })
})

describe('buildEnquiryFormFromEmbed', () => {
  it('adds name and email as required, though neither is in the row', () => {
    const { questions } = buildEnquiryFormFromEmbed([], [])
    // The public embed form renders both unconditionally and refuses to submit
    // without them — an enquiry with no way to reply is not an enquiry. They
    // live nowhere in `fields`, so a literal copy would silently drop them.
    expect(questions).toEqual([
      { id: 'q_name', type: 'CLIENT_FIELD', fieldKey: 'name', required: true },
      { id: 'q_email', type: 'CLIENT_FIELD', fieldKey: 'email', required: true },
    ])
  })

  it('carries the phone toggle and its requiredness across', () => {
    const { questions } = buildEnquiryFormFromEmbed([{ key: 'phone', required: true }], [])
    expect(questions).toContainEqual({
      id: 'q_phone', type: 'CLIENT_FIELD', fieldKey: 'phone', required: true,
    })
  })

  it('makes the message a long-text question, not a client field', () => {
    const { questions } = buildEnquiryFormFromEmbed([{ key: 'message', required: false }], [])
    // There is no client column called "message" — it is the enquiry's own text.
    // A CLIENT_FIELD question would need a key that does not exist.
    expect(questions).toContainEqual({
      id: 'q_message', type: 'LONG_TEXT', label: 'Message', required: false,
    })
  })

  it('skips legacy dog keys rather than quietly asking them again', () => {
    const { questions, skipped } = buildEnquiryFormFromEmbed(
      [
        { key: 'phone', required: false },
        { key: 'dogName', required: true },
        { key: 'dogBreed', required: false },
      ],
      [],
    )
    // The public form has filtered these out since they stopped being standard
    // fields. Converting them in would ADD questions nobody is being asked — a
    // change of behaviour dressed up as a migration.
    expect(skipped).toEqual(['dogName', 'dogBreed'])
    expect(questions.some(q => 'fieldKey' in q && q.fieldKey === 'dogName')).toBe(false)
    // …and they are named, not counted, so a trainer can act on the answer.
    expect(skipped.every(k => typeof k === 'string' && k.length > 0)).toBe(true)
  })

  it('never duplicates name or email when a legacy row lists them', () => {
    const { questions } = buildEnquiryFormFromEmbed(
      [{ key: 'name', required: false }, { key: 'email', required: false }],
      [],
    )
    expect(questions.filter(q => 'fieldKey' in q && q.fieldKey === 'name')).toHaveLength(1)
    // …and the row's `required: false` never downgrades them.
    expect(questions.every(q => q.required)).toBe(true)
  })

  it('links custom fields and takes requiredness from the field, not the form', () => {
    const { questions } = buildEnquiryFormFromEmbed([], ['cf1', 'cf2'], { cf1: true, cf2: false })
    expect(questions).toContainEqual({
      id: 'q_cf1', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: true,
    })
    expect(questions).toContainEqual({
      id: 'q_cf2', type: 'CUSTOM_FIELD', customFieldId: 'cf2', required: false,
    })
  })

  it('keeps the questions in the order the form asks them', () => {
    const { questions } = buildEnquiryFormFromEmbed(
      [{ key: 'phone', required: false }, { key: 'message', required: false }],
      ['cf1'],
      { cf1: false },
    )
    expect(questions.map(q => q.id)).toEqual([
      'q_name', 'q_email', 'q_phone', 'q_message', 'q_cf1',
    ])
  })
})

describe('a converted question, as the BUILDER resolves it', () => {
  it('shows the field’s real label and choices, not a blank editor', () => {
    // The runner and the builder resolve a CUSTOM_FIELD question by two
    // different routes — renderUnifiedForm for the client, fieldSpecFor for the
    // trainer. A conversion that satisfied only one of them would produce a form
    // that fills in correctly and is uneditable, or the reverse.
    const fields = [
      { id: 'f1', label: 'Emergency contact', type: 'TEXT' as const, appliesTo: 'OWNER' as const, category: null, options: [] },
      { id: 'f2', label: 'Food motivated?', type: 'DROPDOWN' as const, appliesTo: 'DOG' as const, category: null, options: ['Yes', 'No'] },
    ]
    const { questions } = buildIntakeFormFromFields([
      { id: 'f1', required: false, appliesTo: 'OWNER' },
      { id: 'f2', required: false, appliesTo: 'DOG' },
    ])

    const specs = questions.map(q => fieldSpecFor(q as LinkedQuestion, fields))
    expect(specs.map(s => s?.label)).toEqual(['Emergency contact', 'Food motivated?'])
    expect(specs[1]?.options).toEqual(['Yes', 'No'])
    // null is what the builder shows as "this pointed at a field that no longer
    // exists" — a converted question must never be in that state on day one.
    expect(specs.every(s => s !== null)).toBe(true)
  })
})
