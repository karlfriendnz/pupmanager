// Shared input validation + defaults for comms-flow steps, used by the CRUD
// routes, the apply-template route and the save-template route so they never
// drift. (Send-side logic lives in comms-flows.ts.)
import { z } from 'zod'

export const channelEnum = z.enum(['PUSH', 'EMAIL', 'IN_APP'])
// BEFORE/AFTER_SESSION are for offerings with a timetable; the PURCHASE and
// PERIOD_END anchors are for memberships, which have no sessions.
export const directionEnum = z.enum(['BEFORE_SESSION', 'AFTER_SESSION', 'AFTER_PURCHASE', 'BEFORE_PERIOD_END'])
// STAFF targets the trainer's own team rather than clients.
export const audienceEnum = z.enum(['ENROLLED', 'ENROLLED_AND_WAITLIST', 'CUSTOM', 'STAFF'])
export type Audience = z.infer<typeof audienceEnum>
export type Channel = z.infer<typeof channelEnum>

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

// A membership has no sessions, so its steps count from the client's purchase.
// Same shape, different anchor + copy.
export const DEFAULT_MEMBERSHIP_STEP_FIELDS: StepFields = {
  ...DEFAULT_STEP_FIELDS,
  direction: 'AFTER_PURCHASE',
  offsetMinutes: 0,
  title: 'Welcome to {{package}} 🎉',
  body: "Hi {{name}}, you're all set — everything included is ready to book in the app.",
}

export function withMembershipDefaults(partial: Partial<StepFields>): StepFields {
  return { ...DEFAULT_MEMBERSHIP_STEP_FIELDS, ...partial }
}

// Validator for a template's stored `steps` JSON when applying it to a run.
export const templateStepsSchema = z.array(stepFieldsSchema)

// ─── In-app is staff-only ────────────────────────────────────────────────────
// A client already gets the push and/or the email; mirroring every one of those
// into their notification feed made the feed useless. Staff DO read their bell,
// so IN_APP survives only on staff-targeted steps. Enforced here rather than in
// the zod schema so an older step (or an older template) is quietly corrected
// instead of failing to save.
export function channelsForAudience<T extends string>(channels: T[], audience: Audience): T[] {
  if (audience === 'STAFF') return channels
  const kept = channels.filter(c => c !== 'IN_APP')
  return kept.length ? kept : (['PUSH'] as unknown as T[])
}

/**
 * Apply the staff-only-in-app rule to a whole (possibly partial) step patch.
 * A PATCH can move either half of the pair — switch the audience to clients, or
 * add in-app to a step that's already client-facing — so the row's current
 * values fill in whichever half the patch didn't send. A patch touching
 * neither is returned untouched.
 */
export function normalizeStepChannels<T extends object>(
  fields: T,
  currentAudience: Audience = 'ENROLLED',
  currentChannels: Channel[] = [],
): T & { channels?: Channel[] } {
  const patch = fields as { channels?: Channel[]; audience?: Audience }
  if (patch.channels === undefined && patch.audience === undefined) return fields
  return {
    ...fields,
    channels: channelsForAudience(patch.channels ?? currentChannels, patch.audience ?? currentAudience),
  }
}

// ─── Reading a flow in time order ────────────────────────────────────────────
// The list is authored in whatever order the trainer added messages, but it
// only makes sense read as a timeline: earliest "before" first, through the
// session, then everything "after". Shared with the editor so the screen and
// any other reader agree.
export function commsTimelinePos(s: { direction: string; offsetMinutes: number }): number {
  // A membership's two anchors are different moments in the client's life, so
  // they can't share a number line with 0 = the session. Purchase-anchored
  // steps come first (they fire from day one); period-end ones sit after, and
  // within them the biggest lead time is the earliest.
  if (s.direction === 'BEFORE_PERIOD_END') return 1_000_000 - s.offsetMinutes
  if (s.direction === 'AFTER_PURCHASE') return s.offsetMinutes
  return s.direction === 'BEFORE_SESSION' ? -s.offsetMinutes : s.offsetMinutes
}

/** Sort a flow into the order it will actually happen in. Stable on ties. */
export function sortStepsByTime<T extends { direction: string; offsetMinutes: number; order?: number }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => {
    const d = commsTimelinePos(a) - commsTimelinePos(b)
    if (d !== 0) return d
    return (a.order ?? 0) - (b.order ?? 0)
  })
}
