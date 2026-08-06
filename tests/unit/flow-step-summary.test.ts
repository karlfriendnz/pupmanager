import { describe, it, expect } from 'vitest'
import {
  flowStepSummary,
  flowStepWhatText,
  flowStepWhenText,
  flowStepWaitText,
  flowStepKindsFor,
  offsetLabel,
  FLOW_STEP_KIND_CATALOG,
  type SummarisableStep,
} from '@/lib/flow-step-summary'
import { flowStepKindEnum } from '@/lib/comms-flow-steps'

// The builder's rows are the only description of a step a trainer ever reads,
// and they are derived from four columns at once. These are the assertions that
// stop a row saying "0 min before" about something that fires on an enquiry.

function step(over: Partial<SummarisableStep> = {}): SummarisableStep {
  return {
    kind: 'MESSAGE',
    actor: 'CLIENT',
    trigger: null,
    direction: 'BEFORE_SESSION',
    offsetMinutes: 1440,
    blocking: false,
    channels: ['PUSH', 'EMAIL'],
    title: null,
    body: null,
    payload: null,
    ...over,
  }
}

describe('flowStepWhatText — every kind says what it does', () => {
  it('a MESSAGE names its channels and its title', () => {
    expect(flowStepWhatText(step({ channels: ['EMAIL'], title: 'What to expect' })))
      .toBe('Send email: What to expect')
    expect(flowStepWhatText(step({ channels: ['PUSH', 'EMAIL'], title: 'See you tomorrow' })))
      .toBe('Send push + email: See you tomorrow')
  })

  it('a MESSAGE with no title still says how it sends', () => {
    expect(flowStepWhatText(step({ channels: ['PUSH'], title: null }))).toBe('Send push')
  })

  it('a FORM names the form, resolved from the ids the builder holds', () => {
    const s = step({ kind: 'FORM', title: null, payload: { formId: 'f1' } })
    expect(flowStepWhatText(s, { forms: { f1: 'Pre-groom questions' } }))
      .toBe('Ask them to fill in: Pre-groom questions')
  })

  it('a FORM with nothing chosen says so, and a deleted form is distinguished', () => {
    expect(flowStepWhatText(step({ kind: 'FORM', payload: {} }))).toBe('Ask them to fill in: not chosen yet')
    expect(flowStepWhatText(step({ kind: 'FORM', payload: { formId: 'gone' } })))
      .toBe('Ask them to fill in: a form that no longer exists')
  })

  it('an UPLOAD uses the trainer’s own words, and falls back per target', () => {
    expect(flowStepWhatText(step({ kind: 'UPLOAD', payload: { label: 'Dog photo upload' } })))
      .toBe('Ask for: Dog photo upload')
    expect(flowStepWhatText(step({ kind: 'UPLOAD', payload: { target: 'DOG_PHOTO' } })))
      .toBe('Ask for: a photo of their dog')
    expect(flowStepWhatText(step({ kind: 'UPLOAD', payload: {} }))).toBe('Ask for: a file')
  })

  it('a TASK names the library item, or the inline title', () => {
    expect(flowStepWhatText(step({ kind: 'TASK', payload: { libraryTaskId: 't1' } }), { tasks: { t1: 'Loose lead' } }))
      .toBe('Give homework: Loose lead')
    expect(flowStepWhatText(step({ kind: 'TASK', payload: { title: 'Practise sit' } })))
      .toBe('Give homework: Practise sit')
    expect(flowStepWhatText(step({ kind: 'TASK', payload: {} }))).toBe('Give homework: not chosen yet')
  })

  it('an ACCOUNT step says which way they get in', () => {
    expect(flowStepWhatText(step({ kind: 'ACCOUNT', payload: {} }))).toBe('They set up their login')
    expect(flowStepWhatText(step({ kind: 'ACCOUNT', payload: { method: 'MAGIC_LINK' } })))
      .toBe('They get a sign-in link')
  })

  it('CHOOSE_OFFERING says how wide the choice is', () => {
    expect(flowStepWhatText(step({ kind: 'CHOOSE_OFFERING', payload: {} })))
      .toBe('They choose what to book — from anything you have published')
    expect(flowStepWhatText(step({ kind: 'CHOOSE_OFFERING', payload: { packageIds: ['a', 'b'] } })))
      .toBe('They choose what to book — from 2 you picked')
  })

  it('APPROVAL is phrased as the trainer’s own move', () => {
    expect(flowStepWhatText(step({ kind: 'APPROVAL', actor: 'TRAINER', payload: {} })))
      .toBe('You accept or move the time')
    expect(flowStepWhatText(step({ kind: 'APPROVAL', actor: 'TRAINER', payload: { allowReschedule: false } })))
      .toBe('You accept the time')
    expect(flowStepWhatText(step({ kind: 'APPROVAL', actor: 'TRAINER', payload: { decides: 'ENROLMENT' } })))
      .toBe('You accept them onto it')
  })

  it('covers every kind in the enum — a new one cannot ship undescribed', () => {
    for (const kind of flowStepKindEnum.options) {
      const text = flowStepWhatText(step({ kind, payload: kind === 'MESSAGE' ? null : {} }))
      expect(text).toBeTruthy()
      expect(text).not.toMatch(/Unknown step/)
    }
  })
})

describe('flowStepWhenText — the timing, in words', () => {
  it('reads a session offset as before/after', () => {
    expect(flowStepWhenText(step({ offsetMinutes: 1440 }))).toBe('1 day before')
    expect(flowStepWhenText(step({ direction: 'AFTER_SESSION', offsetMinutes: 15 }))).toBe('15 minutes after')
  })

  it('never says "0 min before" — zero is the moment itself', () => {
    expect(flowStepWhenText(step({ offsetMinutes: 0 }))).toBe('When the session starts')
    expect(flowStepWhenText(step({ direction: 'AFTER_SESSION', offsetMinutes: 0 }))).toBe('When the session ends')
  })

  it('reads a membership anchor as joining or renewing', () => {
    expect(flowStepWhenText(step({ direction: 'AFTER_PURCHASE', offsetMinutes: 0 }))).toBe('When they join')
    expect(flowStepWhenText(step({ direction: 'AFTER_PURCHASE', offsetMinutes: 4320 }))).toBe('3 days after they join')
    expect(flowStepWhenText(step({ direction: 'BEFORE_PERIOD_END', offsetMinutes: 10080 })))
      .toBe('1 week before it renews')
  })

  it('reads joining as joining, in Karl’s words, not as a lead time', () => {
    expect(flowStepWhenText(step({ direction: 'ON_ENROLMENT', offsetMinutes: 0 }))).toBe('When they enrol')
    expect(flowStepWhenText(step({ direction: 'ON_ENROLMENT', offsetMinutes: 4320 })))
      .toBe('3 days after they enrol')
  })

  it('is not moved by a lead time left over from when it was a reminder', () => {
    // A step switched from "1 day before" to "when they enrol" still holds 1440
    // in the column. Answered BEFORE the before/after wording, so the row cannot
    // read "1 day before" about a step that fires the instant somebody joins.
    expect(flowStepWhenText(step({ direction: 'ON_ENROLMENT', offsetMinutes: 1440 })))
      .toBe('1 day after they enrol')
    expect(flowStepWhenText(step({ direction: 'ON_ENROLMENT', offsetMinutes: 1440 })))
      .not.toContain('before')
  })

  it('a journey’s FIRST step reads off its trigger', () => {
    const s = step({ trigger: 'ON_ENQUIRY_SUBMITTED', offsetMinutes: 0 })
    expect(flowStepWhenText(s, 0)).toBe('As soon as they enquire')
    expect(flowStepWhenText(step({ trigger: 'ON_SIGNUP' }), 0)).toBe('When they sign up')
    expect(flowStepWhenText(step({ trigger: 'ON_BOOKING' }), 0)).toBe('When they book')
  })

  it('a journey’s LATER steps are unlocked by the one before, not by a clock', () => {
    const s = step({ trigger: 'ON_ENQUIRY_SUBMITTED', offsetMinutes: 1440 })
    expect(flowStepWhenText(s, 3)).toBe('Once the step before is done')
  })
})

describe('flowStepWaitText — blocking never reads as a checkbox', () => {
  it('is null when the step does not block', () => {
    expect(flowStepWaitText(step({ kind: 'FORM', blocking: false }))).toBeNull()
  })

  it('says what is being waited FOR, per kind', () => {
    expect(flowStepWaitText(step({ kind: 'FORM', blocking: true }))).toBe('wait for their answers')
    expect(flowStepWaitText(step({ kind: 'UPLOAD', blocking: true }))).toBe('wait for the upload')
    expect(flowStepWaitText(step({ kind: 'TASK', blocking: true }))).toBe('wait until it is ticked off')
    expect(flowStepWaitText(step({ kind: 'ACCOUNT', blocking: true }))).toBe('wait until they have a login')
    expect(flowStepWaitText(step({ kind: 'CHOOSE_OFFERING', blocking: true }))).toBe('wait until they have chosen')
    expect(flowStepWaitText(step({ kind: 'APPROVAL', actor: 'TRAINER', blocking: true }))).toBe('wait for you')
  })

  it('never contains the word "blocking"', () => {
    for (const kind of flowStepKindEnum.options) {
      expect(flowStepWaitText(step({ kind, blocking: true }))).not.toMatch(/block/i)
    }
  })
})

describe('flowStepSummary — the two lines a row shows', () => {
  it('matches the shape Karl approved for a journey', () => {
    const journey: SummarisableStep[] = [
      step({ kind: 'FORM', trigger: 'ON_ENQUIRY_SUBMITTED', offsetMinutes: 0, blocking: true, payload: { formId: 'f1' } }),
      step({ kind: 'MESSAGE', trigger: 'ON_ENQUIRY_SUBMITTED', offsetMinutes: 0, channels: ['EMAIL'], title: 'What to expect', body: 'Hi' }),
    ]
    const names = { forms: { f1: 'Pre-groom questions' } }

    const first = flowStepSummary(journey[0], { index: 0, names })
    expect(first.what).toBe('Ask them to fill in: Pre-groom questions')
    expect(first.line).toBe('wait for their answers')

    const second = flowStepSummary(journey[1], { index: 1, names })
    expect(second.what).toBe('Send email: What to expect')
    expect(second.line).toBe('Once the step before is done')
  })

  it('a clock-anchored blocking step keeps BOTH facts', () => {
    const s = step({ kind: 'FORM', offsetMinutes: 1440, blocking: true, payload: { formId: 'f1' } })
    expect(flowStepSummary(s, { names: { forms: { f1: 'Pre-class questions' } } }).line)
      .toBe('1 day before · wait for their answers')
  })

  it('carries the actor so a trainer’s own step can be told apart', () => {
    expect(flowStepSummary(step({ kind: 'APPROVAL', actor: 'TRAINER' })).actor).toBe('TRAINER')
    expect(flowStepSummary(step()).actor).toBe('CLIENT')
  })

  it('flags a half-built step with the SAME gate the engine uses', () => {
    // executeFlowStep refuses a FORM step with no form; the row must say so
    // rather than leaving the trainer to notice the absence of an email.
    expect(flowStepSummary(step({ kind: 'FORM', payload: {} })).problem).toBe('No form chosen')
    expect(flowStepSummary(step({ kind: 'TASK', payload: {} })).problem).toBe('No task chosen')
    expect(flowStepSummary(step({ kind: 'MESSAGE', title: null, body: null })).problem)
      .toBe('This message has no copy')
  })

  it('a configured step has no problem', () => {
    expect(flowStepSummary(step({ kind: 'FORM', payload: { formId: 'f1' } })).problem).toBeNull()
    expect(flowStepSummary(step({ kind: 'MESSAGE', title: 'Hi', body: 'There' })).problem).toBeNull()
    expect(flowStepSummary(step({ kind: 'UPLOAD', payload: {} })).problem).toBeNull()
  })
})

describe('the step-type picker', () => {
  it('offers all seven kinds in a person’s journey', () => {
    expect(flowStepKindsFor('PERSON')).toHaveLength(flowStepKindEnum.options.length)
  })

  it('hides the three a clock can never fire from a class or a membership', () => {
    for (const anchor of ['SESSION', 'PURCHASE'] as const) {
      const kinds = flowStepKindsFor(anchor).map(o => o.kind)
      expect(kinds).toEqual(['MESSAGE', 'FORM', 'UPLOAD', 'TASK'])
    }
  })

  it('explains every kind it offers', () => {
    for (const option of FLOW_STEP_KIND_CATALOG) {
      expect(option.label.length).toBeGreaterThan(3)
      expect(option.hint.length).toBeGreaterThan(20)
    }
    // Every kind in the enum has an entry — a new kind cannot reach the picker
    // with no explanation beside it.
    expect(FLOW_STEP_KIND_CATALOG.map(o => o.kind).sort()).toEqual([...flowStepKindEnum.options].sort())
  })
})

describe('offsetLabel', () => {
  it('uses the editor’s own words for the presets', () => {
    expect(offsetLabel(1440)).toBe('1 day')
    expect(offsetLabel(10080)).toBe('1 week')
  })
  it('rounds anything else rather than printing minutes for ever', () => {
    expect(offsetLabel(45)).toBe('45 min')
    expect(offsetLabel(180)).toBe('3 hr')
    expect(offsetLabel(20160)).toBe('14 days')
  })
})
