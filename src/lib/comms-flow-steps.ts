// Shared input validation + defaults for comms-flow steps, used by the CRUD
// routes, the apply-template route and the save-template route so they never
// drift. (Send-side logic lives in comms-flows.ts.)
import { z } from 'zod'

export const channelEnum = z.enum(['PUSH', 'EMAIL', 'IN_APP'])
export const directionEnum = z.enum(['BEFORE_SESSION', 'AFTER_SESSION'])
export const audienceEnum = z.enum(['ENROLLED', 'ENROLLED_AND_WAITLIST', 'CUSTOM'])

// Offsets are minutes; cap at 60 days so a stray value can't scan the whole DB.
const MAX_OFFSET_MIN = 60 * 24 * 60

// The full editable shape of one step.
export const stepFieldsSchema = z.object({
  direction: directionEnum,
  offsetMinutes: z.number().int().min(0).max(MAX_OFFSET_MIN),
  channels: z.array(channelEnum).min(1, 'Pick at least one channel'),
  audience: audienceEnum,
  customClientIds: z.array(z.string()),
  important: z.boolean(),
  title: z.string().trim().min(1, 'Add a title').max(200),
  body: z.string().trim().min(1, 'Add a message').max(4000),
  // Optional rich (HTML) body for the EMAIL channel; generous cap since it's
  // formatted markup. Null/absent = use `body` for email too.
  emailBody: z.string().max(50000).nullable().optional(),
  enabled: z.boolean(),
})
export type StepFields = z.infer<typeof stepFieldsSchema>

// PATCH accepts any subset.
export const stepPatchSchema = stepFieldsSchema.partial()

// A sensible default when a trainer taps "Add message".
export const DEFAULT_STEP_FIELDS: StepFields = {
  direction: 'BEFORE_SESSION',
  offsetMinutes: 1440,
  channels: ['PUSH', 'EMAIL'],
  audience: 'ENROLLED',
  customClientIds: [],
  important: false,
  title: 'Reminder from {{business}}',
  body: "Hi {{name}}, just a reminder that {{dog}}'s {{class}} is on {{date}} at {{time}}. See you then!",
  enabled: true,
}

// Create accepts a partial and fills the rest from the default.
export const stepCreateSchema = stepFieldsSchema.partial()

export function withDefaults(partial: Partial<StepFields>): StepFields {
  return { ...DEFAULT_STEP_FIELDS, ...partial }
}

// Validator for a template's stored `steps` JSON when applying it to a run.
export const templateStepsSchema = z.array(stepFieldsSchema)
