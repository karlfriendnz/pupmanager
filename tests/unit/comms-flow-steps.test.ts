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
  sentFieldsOnly,
  withFormDefaults,
  flowStepKindEnum,
  safeFlowStepPayload,
  flowStepConfigProblem,
  uploadSpecFor,
  taskSpecFor,
  defaultsForKind,
  stepSendsNotification,
  deliveryChannelsFor,
  homeworkTimingEnum,
  type Channel,
} from '@/lib/comms-flow-steps'
import { canWaitForCompletion } from '@/lib/flow-anchors'

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

// ─── Phase 2: each kind's configuration is real ─────────────────────────────
//
// Phase 1 stored a shrug — an open object with one optional field per kind —
// because nothing could create one. These are the actual shapes, and the thing
// every one of them has to survive is a ROUND TRIP: what a trainer configured
// has to come back byte for byte after a save and a reload. That is AGENTS.md
// bug #1, the most repeated bug in this repo, and it is repeated because a
// schema that quietly adds a default or drops a field looks fine until somebody
// reopens the screen.

/** Save → store as JSON → reload, the way the database actually does it. */
function roundTrip(kind: Parameters<typeof parseFlowStepPayload>[0], payload: unknown) {
  const validated = stepFieldsSchema.parse({ ...MESSAGE_STEP, kind, title: null, body: null, payload })
  const forWrite = payloadForWrite(validated.payload)
  // Prisma stores a Json column as JSON; anything that can't survive that is
  // lost between the save and the reload with nothing to say it went.
  const stored = JSON.parse(JSON.stringify(forWrite ?? null))
  return parseFlowStepPayload(kind, stored).payload
}

describe('payload round-trips — save, reload, identical', () => {
  const CONFIGURED = {
    FORM: { formId: 'form_123', ctaLabel: 'Start your intake' },
    UPLOAD: { target: 'DOG_PHOTO', accept: 'IMAGE', label: "A photo of your dog", minCount: 1, maxCount: 3, maxMb: 8 },
    TASK: { libraryTaskId: 'lib_1', description: null, repetitions: 10, videoUrl: 'https://v/1', timing: 'BEFORE_SESSION' },
    ACCOUNT: { method: 'PASSWORD', redirectTo: '/home' },
    CHOOSE_OFFERING: { packageIds: ['pkg_1', 'pkg_2'], allowMultiple: true, requireTime: true },
    APPROVAL: { decides: 'BOOKING_TIME', allowReschedule: true, autoApproveHours: 48 },
  } as const

  for (const [kind, payload] of Object.entries(CONFIGURED)) {
    it(`a fully-configured ${kind} step comes back exactly as it was saved`, () => {
      expect(roundTrip(kind as keyof typeof CONFIGURED, payload)).toEqual(payload)
    })
  }

  // The half of the bug that a "does it save?" test never catches: a schema
  // default materialises a key nobody typed, so the second save writes
  // something different from the first and a diff of the two is never empty.
  it('adds nothing a trainer did not configure', () => {
    for (const kind of Object.keys(CONFIGURED) as (keyof typeof CONFIGURED)[]) {
      expect(roundTrip(kind, {}), `${kind} invented a field`).toEqual({})
    }
  })

  it('drops a key from a later phase rather than refusing the save', () => {
    expect(roundTrip('FORM', { formId: 'f1', somethingPhase9Added: true })).toEqual({ formId: 'f1' })
  })

  it('survives a second trip unchanged — the reopen-and-save-again case', () => {
    const once = roundTrip('UPLOAD', CONFIGURED.UPLOAD)
    expect(roundTrip('UPLOAD', once)).toEqual(once)
  })
})

describe('FORM payload', () => {
  it('names the form to send', () => {
    expect(parseFlowStepPayload('FORM', { formId: 'f1' }).payload).toEqual({ formId: 'f1' })
  })

  // `blocking` is a COLUMN. A second copy of the same fact inside the JSON is
  // how the trigger/direction pair would have drifted, and it would drift here
  // the first time a PATCH moved one and not the other.
  it('does not carry its own "does this block" flag — that is the column', () => {
    expect(roundTrip('FORM', { formId: 'f1', blocking: true, blocksProgress: true })).toEqual({ formId: 'f1' })
    const step = stepFieldsSchema.parse({ ...MESSAGE_STEP, kind: 'FORM', title: null, body: null, blocking: true, payload: { formId: 'f1' } })
    expect(step.blocking).toBe(true)
  })

  it('refuses copy that is not a string', () => {
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, kind: 'FORM', payload: { ctaLabel: 42 } }).success).toBe(false)
  })
})

describe('UPLOAD payload', () => {
  it('says what is being asked for and where it lands', () => {
    const spec = uploadSpecFor(parseFlowStepPayload('UPLOAD', { target: 'DOG_PHOTO' }).payload)
    expect(spec.target).toBe('DOG_PHOTO')
    expect(spec.accept).toBe('IMAGE') // a dog photo is a photo
    expect(spec.maxCount).toBe(1)
    expect(spec.maxMb).toBe(10) // the same cap /api/upload/image enforces
  })

  it('defaults an unconfigured step to one general attachment', () => {
    expect(uploadSpecFor(null)).toMatchObject({ target: 'ATTACHMENT', accept: 'ANY', minCount: 1, maxCount: 1 })
  })

  it('refuses a dog photo that would accept a PDF', () => {
    expect(stepFieldsSchema.safeParse({
      ...MESSAGE_STEP, kind: 'UPLOAD', title: null, body: null,
      payload: { target: 'DOG_PHOTO', accept: 'ANY' },
    }).success).toBe(false)
  })

  it('refuses a minimum bigger than the maximum', () => {
    expect(stepFieldsSchema.safeParse({
      ...MESSAGE_STEP, kind: 'UPLOAD', title: null, body: null,
      payload: { minCount: 4, maxCount: 2 },
    }).success).toBe(false)
  })

  it('caps the size a step may ask for — the request body gives out first', () => {
    expect(stepFieldsSchema.safeParse({
      ...MESSAGE_STEP, kind: 'UPLOAD', title: null, body: null, payload: { maxMb: 500 },
    }).success).toBe(false)
  })
})

describe('TASK payload', () => {
  // The point of the shape: it is PackageDefaultTask's, so a TASK step hands out
  // the same homework the offering's defaults do, from the same library.
  it('takes a library item and reads its text live', () => {
    const spec = taskSpecFor(parseFlowStepPayload('TASK', { libraryTaskId: 'lib_1' }).payload)
    expect(spec).toMatchObject({ libraryTaskId: 'lib_1', title: null, timing: 'AFTER_SESSION' })
  })

  it('takes an inline one-off instead', () => {
    const spec = taskSpecFor(parseFlowStepPayload('TASK', { title: 'Practise sit', repetitions: 5 }).payload)
    expect(spec).toMatchObject({ libraryTaskId: null, title: 'Practise sit', repetitions: 5 })
  })

  it('refuses both at once — a library item is named by the library', () => {
    expect(stepFieldsSchema.safeParse({
      ...MESSAGE_STEP, kind: 'TASK', title: null, body: null,
      payload: { libraryTaskId: 'lib_1', title: 'Something else' },
    }).success).toBe(false)
  })

  it('only knows the two timings HomeworkTiming has', () => {
    expect(homeworkTimingEnum.options).toEqual(['BEFORE_SESSION', 'AFTER_SESSION'])
  })
})

describe('ACCOUNT payload', () => {
  it('refuses a redirect off the app — that is an open redirect', () => {
    for (const redirectTo of ['https://evil.test', '//evil.test', 'javascript:alert(1)']) {
      expect(
        stepFieldsSchema.safeParse({ ...MESSAGE_STEP, kind: 'ACCOUNT', title: null, body: null, payload: { redirectTo } }).success,
        redirectTo,
      ).toBe(false)
    }
    expect(stepFieldsSchema.safeParse({ ...MESSAGE_STEP, kind: 'ACCOUNT', title: null, body: null, payload: { redirectTo: '/home' } }).success).toBe(true)
  })
})

describe('flowStepConfigProblem', () => {
  it('lets a configured step run', () => {
    expect(flowStepConfigProblem({ kind: 'FORM', payload: { formId: 'f1' } })).toBeNull()
    expect(flowStepConfigProblem({ kind: 'TASK', payload: { libraryTaskId: 'l1' } })).toBeNull()
    expect(flowStepConfigProblem({ kind: 'UPLOAD', payload: null })).toBeNull()
    expect(flowStepConfigProblem({ kind: 'MESSAGE', payload: null, title: 't', body: 'b' })).toBeNull()
  })

  // Saving a half-built step is allowed on purpose — a trainer adds it and then
  // configures it. Running one is not: a "fill in this form" notification with
  // no form on the end of it is worse than silence.
  it('holds back a step that was never finished', () => {
    expect(flowStepConfigProblem({ kind: 'FORM', payload: {} })).toBe('No form chosen')
    expect(flowStepConfigProblem({ kind: 'TASK', payload: {} })).toBe('No task chosen')
    expect(flowStepConfigProblem({ kind: 'MESSAGE', payload: null, title: null, body: null })).toBeTruthy()
  })

  it('reads a corrupted payload as unconfigured rather than throwing', () => {
    expect(flowStepConfigProblem({ kind: 'FORM', payload: { formId: 42 } })).toBe('No form chosen')
    expect(safeFlowStepPayload('UPLOAD', 'not an object').payload).toEqual({})
  })
})

describe('defaultsForKind', () => {
  it('leaves a message step exactly as it always was', () => {
    expect(defaultsForKind('MESSAGE')).toEqual(DEFAULT_STEP_FIELDS)
  })

  // Seeding "Reminder from {{business}}" onto a FORM step would put a stray
  // title on a row whose whole point is that it has none — and the first thing
  // to read it would be a client's inbox.
  it('gives a non-message step no copy, and makes it a wall', () => {
    const form = defaultsForKind('FORM')
    expect(form).toMatchObject({ kind: 'FORM', title: null, body: null, blocking: true, offsetMinutes: 0 })
    expect(stepFieldsSchema.safeParse(form).success).toBe(true)
  })

  it('withDefaults follows the kind it was handed', () => {
    expect(withDefaults({ kind: 'UPLOAD' })).toMatchObject({ kind: 'UPLOAD', title: null, blocking: true })
    expect(withMembershipDefaults({ kind: 'UPLOAD' })).toMatchObject({ kind: 'UPLOAD', direction: 'AFTER_PURCHASE', title: null })
    // …and still fills a message the way it always did.
    expect(withDefaults({}).title).toBe(DEFAULT_STEP_FIELDS.title)
    expect(withMembershipDefaults({}).title).toBe(DEFAULT_MEMBERSHIP_STEP_FIELDS.title)
  })
})

describe('sentFieldsOnly — the defaults zod leaves behind', () => {
  it('keeps only the keys the caller actually put in the body', () => {
    const raw = { enabled: false }
    const parsed = stepPatchSchema.parse(raw)
    // Proof of the trap this exists for: zod materialised three keys nobody sent.
    expect(parsed).toHaveProperty('kind', 'MESSAGE')
    expect(parsed).toHaveProperty('actor', 'CLIENT')
    expect(parsed).toHaveProperty('blocking', false)
    // …and the filter puts it back to what was meant.
    expect(sentFieldsOnly(raw, parsed)).toEqual({ enabled: false })
  })

  it('passes a real field through untouched, false and null included', () => {
    const raw = { title: 'Hi', important: false, emailBody: null }
    expect(sentFieldsOnly(raw, stepPatchSchema.parse(raw))).toEqual(raw)
  })

  it('a body that is not an object yields nothing to write', () => {
    expect(sentFieldsOnly(null, { kind: 'MESSAGE' })).toEqual({})
    expect(sentFieldsOnly('nope', { kind: 'MESSAGE' })).toEqual({})
  })
})

describe('canWaitForCompletion — what may block a journey', () => {
  // Each of these has a route that writes the completion. Adding a kind here
  // without one is how a journey stops dead — see lib/flow-completions.
  it('is true for the kinds something actually ticks off', () => {
    for (const kind of ['ACCOUNT', 'FORM', 'TASK'] as const) {
      expect(canWaitForCompletion(kind), kind).toBe(true)
    }
  })

  it('is false for the kinds nothing records the answer to', () => {
    for (const kind of ['MESSAGE', 'CHOOSE_OFFERING', 'APPROVAL'] as const) {
      expect(canWaitForCompletion(kind), kind).toBe(false)
    }
  })

  // The one kind whose answer depends on its configuration rather than its
  // kind: a dog photo lands on the dog, so the app sees it arrive. Anything
  // else is sent by email or handed over at the class, and nothing sees it.
  it('lets an UPLOAD block only when it asks for the dog’s photo', () => {
    expect(canWaitForCompletion('UPLOAD', { target: 'DOG_PHOTO' })).toBe(true)
    expect(canWaitForCompletion('UPLOAD', { target: 'ATTACHMENT' })).toBe(false)
    // Unset means ATTACHMENT, read through uploadSpecFor rather than the raw JSON.
    expect(canWaitForCompletion('UPLOAD')).toBe(false)
    expect(canWaitForCompletion('UPLOAD', {})).toBe(false)
    expect(canWaitForCompletion('UPLOAD', 'not even an object')).toBe(false)
  })

  it('answers for every kind in the enum', () => {
    for (const kind of flowStepKindEnum.options) {
      expect(typeof canWaitForCompletion(kind), kind).toBe('boolean')
    }
  })

  it('withFormDefaults refuses to create a wall nothing can take down', () => {
    expect(withFormDefaults({ kind: 'CHOOSE_OFFERING', blocking: true }).blocking).toBe(false)
    expect(withFormDefaults({ kind: 'ACCOUNT' }).blocking).toBe(true)
    expect(withFormDefaults({ kind: 'FORM' }).blocking).toBe(true)
    // An UPLOAD starts unconfigured, so it starts as a nudge rather than a wall.
    expect(withFormDefaults({ kind: 'UPLOAD' }).blocking).toBe(false)
    expect(withFormDefaults({ kind: 'UPLOAD', payload: { target: 'DOG_PHOTO' } }).blocking).toBe(true)
  })
})

// ─── A step does ONE thing ──────────────────────────────────────────────────
//
// Karl, on the "Give them homework" editor asking him for push/email channels
// and a message to write: "i don't think we need notifications if people are
// doing homework or forms this should be its own step".
//
// This predicate is the single source of that fact. The engine reads it to
// decide what to deliver on; the builder reads it to decide whether to show Who
// / How / What it says / Always send at all. Testing it here is testing both.
describe('stepSendsNotification — which kinds send anything of their own', () => {
  it('is false for the three kinds that ARE an action', () => {
    expect(stepSendsNotification('FORM')).toBe(false)
    expect(stepSendsNotification('UPLOAD')).toBe(false)
    expect(stepSendsNotification('TASK')).toBe(false)
  })

  // A MESSAGE is the sending. The three journey kinds have no screen of their
  // own to be discovered on — there is no "an account you haven't set up yet"
  // list — so their notification is the only way anybody learns of them.
  it('is true for a MESSAGE and for the journey kinds', () => {
    expect(stepSendsNotification('MESSAGE')).toBe(true)
    expect(stepSendsNotification('ACCOUNT')).toBe(true)
    expect(stepSendsNotification('CHOOSE_OFFERING')).toBe(true)
    expect(stepSendsNotification('APPROVAL')).toBe(true)
  })

  it('answers for every kind in the enum', () => {
    for (const kind of flowStepKindEnum.options) {
      expect(typeof stepSendsNotification(kind), kind).toBe('boolean')
    }
  })
})

describe('deliveryChannelsFor — what a step actually delivers on', () => {
  // The stored column is left alone (a step switched back to a message must
  // still have the trainer's channels), so this is what decides its meaning.
  it('narrows a silent step to the in-app feed, whatever it stored', () => {
    expect(deliveryChannelsFor('TASK', ['PUSH', 'EMAIL'])).toEqual(['IN_APP'])
    expect(deliveryChannelsFor('FORM', ['EMAIL'])).toEqual(['IN_APP'])
    expect(deliveryChannelsFor('UPLOAD', [])).toEqual(['IN_APP'])
  })

  // Not silence. A silently-assigned piece of homework nobody ever sees is a
  // worse outcome than the noisy version — the feed row is what makes it
  // findable, and it is the one channel deliver() writes without a mute check.
  it('never leaves a silent step with nothing at all', () => {
    for (const kind of ['FORM', 'UPLOAD', 'TASK'] as const) {
      expect(deliveryChannelsFor(kind, []).length, kind).toBeGreaterThan(0)
    }
  })

  it('leaves a MESSAGE exactly as its trainer configured it', () => {
    expect(deliveryChannelsFor('MESSAGE', ['PUSH', 'EMAIL'])).toEqual(['PUSH', 'EMAIL'])
    expect(deliveryChannelsFor('MESSAGE', ['IN_APP'])).toEqual(['IN_APP'])
    expect(deliveryChannelsFor('APPROVAL', ['PUSH'])).toEqual(['PUSH'])
  })
})
