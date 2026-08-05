import { describe, it, expect } from 'vitest'
import {
  audienceEnum,
  channelsForAudience,
  normalizeStepChannels,
  stepWriteData,
  commsTimelinePos,
  sortStepsByTime,
  stepFieldsSchema,
  stepPatchSchema,
  stepCreateSchema,
  templateStepsSchema,
  DEFAULT_STEP_FIELDS,
  DEFAULT_MEMBERSHIP_STEP_FIELDS,
  withDefaults,
  withMembershipDefaults,
  parseFlowStepPayload,
  payloadForWrite,
  personTriggerEnum,
  flowTriggerEnum,
  flowStepKindEnum,
  type Channel,
} from '@/lib/comms-flow-steps'

// The two rules the comms-flow screen and its routes both depend on:
//   • in-app is a STAFF-only channel
//   • a flow is read in the order it will actually happen

describe('audience', () => {
  it('accepts the staff audience', () => {
    expect(audienceEnum.safeParse('STAFF').success).toBe(true)
  })
})

describe('channelsForAudience', () => {
  it('drops in-app from a client-facing step', () => {
    expect(channelsForAudience(['PUSH', 'IN_APP', 'EMAIL'] as Channel[], 'ENROLLED')).toEqual(['PUSH', 'EMAIL'])
  })

  it('keeps in-app for a staff step', () => {
    expect(channelsForAudience(['PUSH', 'IN_APP'] as Channel[], 'STAFF')).toEqual(['PUSH', 'IN_APP'])
  })

  it('never leaves a client step with no way to send', () => {
    expect(channelsForAudience(['IN_APP'] as Channel[], 'ENROLLED')).toEqual(['PUSH'])
  })

  it('leaves email-only alone', () => {
    expect(channelsForAudience(['EMAIL'] as Channel[], 'CUSTOM')).toEqual(['EMAIL'])
  })
})

describe('normalizeStepChannels', () => {
  it('re-checks the channels when only the audience changes', () => {
    const out = normalizeStepChannels({ audience: 'ENROLLED' as const }, 'STAFF', ['PUSH', 'IN_APP'])
    expect(out.channels).toEqual(['PUSH'])
  })

  it('re-checks the audience when only the channels change', () => {
    const out = normalizeStepChannels({ channels: ['EMAIL', 'IN_APP'] as Channel[] }, 'STAFF', ['PUSH'])
    expect(out.channels).toEqual(['EMAIL', 'IN_APP']) // still a staff step
  })

  it('leaves a patch that touches neither untouched', () => {
    const patch = { title: 'x' } as { title: string }
    expect(normalizeStepChannels(patch, 'ENROLLED', ['PUSH', 'IN_APP'])).toBe(patch)
  })
})

describe('sortStepsByTime', () => {
  it('reads a session flow earliest-before → after', () => {
    const steps = [
      { id: 'a', direction: 'AFTER_SESSION', offsetMinutes: 120 },
      { id: 'b', direction: 'BEFORE_SESSION', offsetMinutes: 15 },
      { id: 'c', direction: 'BEFORE_SESSION', offsetMinutes: 10080 },
      { id: 'd', direction: 'AFTER_SESSION', offsetMinutes: 30 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('puts a membership welcome before its renewal reminder', () => {
    const steps = [
      { id: 'renew', direction: 'BEFORE_PERIOD_END', offsetMinutes: 4320 },
      { id: 'day7', direction: 'AFTER_PURCHASE', offsetMinutes: 10080 },
      { id: 'welcome', direction: 'AFTER_PURCHASE', offsetMinutes: 0 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['welcome', 'day7', 'renew'])
  })

  it('breaks a tie on the authored order, not on chance', () => {
    const steps = [
      { id: 'second', direction: 'BEFORE_SESSION', offsetMinutes: 60, order: 5 },
      { id: 'first', direction: 'BEFORE_SESSION', offsetMinutes: 60, order: 1 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['first', 'second'])
  })

  it('does not mutate the array it was given', () => {
    const steps = [
      { id: 'a', direction: 'AFTER_SESSION', offsetMinutes: 5 },
      { id: 'b', direction: 'BEFORE_SESSION', offsetMinutes: 5 },
    ]
    sortStepsByTime(steps)
    expect(steps.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('a longer lead time is always earlier', () => {
    expect(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 10080 }))
      .toBeLessThan(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 15 }))
  })
})

// ─── Flows widened past messages ────────────────────────────────────────────
// A step is now one step of a FLOW. Three things must stay true through that:
// a step nobody labels is still a message; a MESSAGE step still cannot be saved
// empty; and a payload has to match the kind on the same row.

const MESSAGE_STEP = {
  direction: 'BEFORE_SESSION',
  offsetMinutes: 1440,
  channels: ['PUSH'],
  audience: 'ENROLLED',
  customClientIds: [],
  important: false,
  title: 'See you tomorrow',
  body: 'Bring treats.',
  enabled: true,
}

describe('kind', () => {
  it('defaults to MESSAGE, so a caller that never heard of kinds means what it always meant', () => {
    const parsed = stepFieldsSchema.parse(MESSAGE_STEP)
    expect(parsed.kind).toBe('MESSAGE')
    expect(parsed.actor).toBe('CLIENT')
    expect(parsed.blocking).toBe(false)
  })

  it('is MESSAGE in both defaults and both fillers', () => {
    expect(DEFAULT_STEP_FIELDS.kind).toBe('MESSAGE')
    expect(DEFAULT_MEMBERSHIP_STEP_FIELDS.kind).toBe('MESSAGE')
    expect(withDefaults({}).kind).toBe('MESSAGE')
    expect(withMembershipDefaults({}).kind).toBe('MESSAGE')
  })

  it('a default step is a valid step', () => {
    expect(stepFieldsSchema.safeParse(DEFAULT_STEP_FIELDS).success).toBe(true)
    expect(stepFieldsSchema.safeParse(DEFAULT_MEMBERSHIP_STEP_FIELDS).success).toBe(true)
  })

  it('knows the seven kinds the journey needs', () => {
    expect(flowStepKindEnum.options).toEqual([
      'MESSAGE', 'FORM', 'UPLOAD', 'TASK', 'ACCOUNT', 'CHOOSE_OFFERING', 'APPROVAL',
    ])
  })
})

describe('title and body', () => {
  // Rule 3 in AGENTS.md: whatever the form refuses, the route must refuse. The
  // COLUMNS went nullable; the rule for a message did not move.
  it('still refuses a MESSAGE step with no title', () => {
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, title: null }).success).toBe(false)
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, title: '   ' }).success).toBe(false)
  })

  it('still refuses a MESSAGE step with no body', () => {
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, body: null }).success).toBe(false)
  })

  it('lets a non-message step have neither — it has no copy to write', () => {
    const parsed = stepFieldsSchema.safeParse({ ...MESSAGE_STEP, kind: 'FORM', title: null, body: null })
    expect(parsed.success).toBe(true)
  })

  it('refuses a PATCH that blanks a message step\'s title', () => {
    expect(stepPatchSchema.safeParse({ title: null }).success).toBe(false)
    expect(stepPatchSchema.safeParse({ body: '' }).success).toBe(false)
  })

  it('lets a PATCH that never mentions them through', () => {
    expect(stepPatchSchema.safeParse({ enabled: false }).success).toBe(true)
  })

  it('lets a non-message PATCH clear them', () => {
    expect(stepPatchSchema.safeParse({ kind: 'UPLOAD', title: null, body: null }).success).toBe(true)
  })
})

describe('payload', () => {
  it('is null for a message — there is nothing to configure', () => {
    expect(parseFlowStepPayload('MESSAGE', null)).toEqual({ kind: 'MESSAGE', payload: null })
    // Even if something hands one in, a message keeps none.
    expect(parseFlowStepPayload('MESSAGE', { formId: 'x' })).toEqual({ kind: 'MESSAGE', payload: null })
  })

  it('refuses a payload on a message step', () => {
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, payload: { formId: 'f1' } }).success).toBe(false)
  })

  it('carries a form step\'s form id', () => {
    expect(parseFlowStepPayload('FORM', { formId: 'f1' })).toEqual({ kind: 'FORM', payload: { formId: 'f1' } })
  })

  it('treats an unconfigured non-message step as empty, not invalid', () => {
    expect(parseFlowStepPayload('FORM', null)).toEqual({ kind: 'FORM', payload: {} })
  })

  it('keeps the fields phase 2 has not named yet', () => {
    const out = parseFlowStepPayload('UPLOAD', { label: 'A photo of your dog', maxMb: 5 })
    expect(out.payload).toMatchObject({ label: 'A photo of your dog', maxMb: 5 })
  })

  it('refuses a form step whose formId is the wrong shape', () => {
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, kind: 'FORM', payload: { formId: 42 } }).success).toBe(false)
  })

  it('narrows null to undefined for a write, so a create leaves the column alone', () => {
    expect(payloadForWrite(null)).toBeUndefined()
    expect(payloadForWrite(undefined)).toBeUndefined()
    expect(payloadForWrite({ formId: 'f1' })).toEqual({ formId: 'f1' })
  })
})

describe('trigger', () => {
  it('knows all seven triggers, the four legacy ones included', () => {
    expect(flowTriggerEnum.options).toContain('BEFORE_SESSION')
    expect(flowTriggerEnum.options).toContain('ON_ENQUIRY_SUBMITTED')
  })

  // Two columns holding one fact is how they end up disagreeing: patch the
  // direction, forget the trigger, and the engine and the screen believe
  // different things. A clock-anchored step states its trigger in `direction`.
  it('only lets a step SET a person-anchored trigger', () => {
    expect(personTriggerEnum.options).toEqual(['ON_ENQUIRY_SUBMITTED', 'ON_SIGNUP', 'ON_BOOKING'])
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, trigger: 'ON_SIGNUP' }).success).toBe(true)
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, trigger: 'BEFORE_SESSION' }).success).toBe(false)
  })

  it('defaults to null — the step is anchored by its direction', () => {
    expect(DEFAULT_STEP_FIELDS.trigger).toBeNull()
  })
})

describe('templates carry the whole step', () => {
  // Same lesson as the emailBody bug: a field the template forgets is a field
  // that comes back wrong, and the flow applied elsewhere is not the flow saved.
  it('accepts a template written before flows widened', () => {
    const parsed = templateStepsSchema.safeParse([MESSAGE_STEP])
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data[0].kind).toBe('MESSAGE')
  })

  it('round-trips a non-message step and its configuration', () => {
    const step = { ...MESSAGE_STEP, kind: 'FORM', title: null, body: null, blocking: true, trigger: 'ON_ENQUIRY_SUBMITTED', payload: { formId: 'f1' } }
    const parsed = templateStepsSchema.safeParse([step])
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data[0]).toMatchObject({
      kind: 'FORM', blocking: true, trigger: 'ON_ENQUIRY_SUBMITTED', payload: { formId: 'f1' },
    })
  })
})

describe('stepWriteData', () => {
  it('still applies the staff-only-in-app rule', () => {
    const out = stepWriteData({ audience: 'ENROLLED' as const }, 'STAFF', ['PUSH', 'IN_APP'])
    expect(out.channels).toEqual(['PUSH'])
  })

  it('narrows a payload on its way to the database', () => {
    const out = stepWriteData({ kind: 'FORM' as const, payload: { formId: 'f1' } })
    expect(out.payload).toEqual({ formId: 'f1' })
  })

  it('leaves a patch that mentions neither untouched', () => {
    const patch = { enabled: false }
    expect(stepWriteData(patch)).toBe(patch)
  })
})

describe('create accepts a partial', () => {
  it('takes an empty body and lets withDefaults fill it', () => {
    const parsed = stepCreateSchema.safeParse({})
    expect(parsed.success).toBe(true)
    expect(parsed.success && withDefaults(parsed.data).title).toBe(DEFAULT_STEP_FIELDS.title)
  })
})
