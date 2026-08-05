// Shared input validation + defaults for comms-flow steps, used by the CRUD
// routes, the apply-template route and the save-template route so they never
// drift. (Send-side logic lives in comms-flows.ts; the flow-engine primitives —
// trigger resolution, sequencing, the completion ledger — live in flow-steps.ts.)
import { z } from 'zod'
// Type-only, so it is erased before this module reaches the browser (the
// comms-flow editor is a 'use client' component and imports from here).
import type { Prisma } from '@/generated/prisma'

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

// ─── Kind, actor and trigger ────────────────────────────────────────────────
// A step used to be one thing: a timed message. It is now one step of a flow,
// and the flow can be a person's journey (enquiry → account → intake → choose
// an offering → the trainer accepts) as easily as a class's reminders.
export const flowStepKindEnum = z.enum([
  'MESSAGE', // the only kind that exists in the database today
  'FORM',
  'UPLOAD',
  'TASK',
  'ACCOUNT',
  'CHOOSE_OFFERING',
  'APPROVAL',
])
export type FlowStepKind = z.infer<typeof flowStepKindEnum>

export const flowStepActorEnum = z.enum(['CLIENT', 'TRAINER'])
export type FlowStepActor = z.infer<typeof flowStepActorEnum>

/** Every trigger the engine knows, including the four that live in `direction`. */
export const flowTriggerEnum = z.enum([
  'BEFORE_SESSION',
  'AFTER_SESSION',
  'AFTER_PURCHASE',
  'BEFORE_PERIOD_END',
  'ON_ENQUIRY_SUBMITTED',
  'ON_SIGNUP',
  'ON_BOOKING',
])
export type FlowTrigger = z.infer<typeof flowTriggerEnum>

/**
 * The triggers a step may SET on its `trigger` column.
 *
 * Deliberately only the person-anchored three. A session/purchase-anchored step
 * already states its trigger in `direction`, and writing the same fact into two
 * columns is how they end up disagreeing — patch the direction, forget the
 * trigger, and the engine and the screen now believe different things. Reads go
 * through `flowTriggerFor()`, which returns all seven.
 */
export const personTriggerEnum = z.enum(['ON_ENQUIRY_SUBMITTED', 'ON_SIGNUP', 'ON_BOOKING'])
export type PersonTrigger = z.infer<typeof personTriggerEnum>

// ─── Payloads ───────────────────────────────────────────────────────────────
// Kind-specific configuration. MESSAGE has none — its copy stays in
// title/body/emailBody, where the editor, the renderer and every existing row
// already keep it.
//
// Phase 1 keeps the non-MESSAGE shapes minimal and open (`.catchall`): nothing
// can create one yet, and guessing at fields now would only mean guessing wrong
// and migrating twice. Phase 2 tightens each one as its step type is built.
const openPayload = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catchall(z.unknown())

export const formStepPayloadSchema = openPayload({ formId: z.string().min(1).optional() })
export const uploadStepPayloadSchema = openPayload({ label: z.string().max(200).optional() })
export const taskStepPayloadSchema = openPayload({ label: z.string().max(200).optional() })
export const accountStepPayloadSchema = openPayload({})
export const chooseOfferingStepPayloadSchema = openPayload({
  /** Which offerings they may pick from. Empty/absent = everything published. */
  packageIds: z.array(z.string()).optional(),
})
export const approvalStepPayloadSchema = openPayload({})

/**
 * The payload schema for each kind. MESSAGE is `null` — not an empty object —
 * so "a message step carries no config" is a fact the parser enforces rather
 * than a convention somebody has to remember.
 */
export const PAYLOAD_SCHEMA_BY_KIND = {
  MESSAGE: z.null(),
  FORM: formStepPayloadSchema,
  UPLOAD: uploadStepPayloadSchema,
  TASK: taskStepPayloadSchema,
  ACCOUNT: accountStepPayloadSchema,
  CHOOSE_OFFERING: chooseOfferingStepPayloadSchema,
  APPROVAL: approvalStepPayloadSchema,
} as const satisfies Record<FlowStepKind, z.ZodTypeAny>

/**
 * A step's kind and its payload, as one discriminated union.
 *
 * The discriminator lives on the ROW (`kind`), not inside the JSON, so this is
 * built from the pair rather than declared with `z.discriminatedUnion` — the
 * alternative is duplicating `kind` into the payload, which is the same
 * two-columns-one-fact trap as the trigger.
 */
export type FlowStepPayload =
  | { kind: 'MESSAGE'; payload: null }
  | { kind: 'FORM'; payload: z.infer<typeof formStepPayloadSchema> }
  | { kind: 'UPLOAD'; payload: z.infer<typeof uploadStepPayloadSchema> }
  | { kind: 'TASK'; payload: z.infer<typeof taskStepPayloadSchema> }
  | { kind: 'ACCOUNT'; payload: z.infer<typeof accountStepPayloadSchema> }
  | { kind: 'CHOOSE_OFFERING'; payload: z.infer<typeof chooseOfferingStepPayloadSchema> }
  | { kind: 'APPROVAL'; payload: z.infer<typeof approvalStepPayloadSchema> }

/**
 * A validated payload, narrowed to what Prisma accepts on a Json column.
 * `undefined` (not null) for "nothing to write", so a create leaves the column
 * at its default instead of stamping a JSON null over it.
 */
export function payloadForWrite(payload: unknown): Prisma.InputJsonValue | undefined {
  return payload == null ? undefined : (payload as Prisma.InputJsonValue)
}

/** Parse a stored payload against the kind on the row. Throws on a mismatch. */
export function parseFlowStepPayload(kind: FlowStepKind, payload: unknown): FlowStepPayload {
  // A null payload on a non-message step is "not configured yet", not invalid —
  // a trainer adds the step, then fills it in.
  const value = kind === 'MESSAGE' ? null : (payload ?? {})
  return { kind, payload: PAYLOAD_SCHEMA_BY_KIND[kind].parse(value) } as FlowStepPayload
}

// The full editable shape of one step.
//
// Split from `stepFieldsSchema` because the cross-field rules below are a
// refinement, and a refined schema has no `.partial()` — which the PATCH route
// needs.
const stepFieldsBase = z.object({
  // Defaults to MESSAGE so a template saved before flows widened, and every
  // caller that doesn't mention a kind, still means what it always meant.
  kind: flowStepKindEnum.default('MESSAGE'),
  actor: flowStepActorEnum.default('CLIENT'),
  // Person-anchored steps only — see personTriggerEnum. Null/absent means the
  // step is anchored by `direction`.
  trigger: personTriggerEnum.nullable().optional(),
  blocking: z.boolean().default(false),
  direction: directionEnum,
  offsetMinutes: z.number().int().min(0).max(MAX_OFFSET_MIN),
  channels: z.array(channelEnum).min(1, 'Pick at least one channel'),
  audience: audienceEnum,
  customClientIds: z.array(z.string()),
  important: z.boolean(),
  // Nullable since a FORM/UPLOAD/TASK step carries no message copy. Still
  // REQUIRED for a MESSAGE step — enforced by the refinement below, because
  // that is the one rule the column type cannot express.
  title: z.string().trim().min(1, 'Add a title').max(200).nullable(),
  body: z.string().trim().min(1, 'Add a message').max(4000).nullable(),
  // Optional rich (HTML) body for the EMAIL channel; generous cap since it's
  // formatted markup. Null/absent = use `body` for email too.
  emailBody: z.string().max(50000).nullable().optional(),
  payload: z.unknown().nullable().optional(),
  enabled: z.boolean(),
})

/**
 * The rules that span fields:
 *   • a MESSAGE step must have a title and a body — that is unchanged from
 *     before flows widened, and it is what stops an empty reminder shipping;
 *   • a payload must match the kind on the same row.
 */
function refineStep(
  s: { kind?: FlowStepKind; title?: string | null; body?: string | null; payload?: unknown },
  ctx: z.RefinementCtx,
  { requireMessageCopy }: { requireMessageCopy: boolean },
): void {
  const kind = s.kind ?? 'MESSAGE'
  if (kind === 'MESSAGE') {
    // On a PATCH only the keys that were sent are checked — clearing the title
    // of a message step is still refused, but not sending one is fine.
    if ((requireMessageCopy || 'title' in s) && !s.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Add a title' })
    }
    if ((requireMessageCopy || 'body' in s) && !s.body) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Add a message' })
    }
  }
  if (s.payload !== undefined) {
    // A MESSAGE step's copy lives in title/body. A payload arriving on one means
    // the caller believes something about this step that isn't true — take it as
    // a mistake rather than storing config nothing will ever read.
    const parsed = PAYLOAD_SCHEMA_BY_KIND[kind].safeParse(kind === 'MESSAGE' ? s.payload : (s.payload ?? {}))
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['payload'], message: `Not a valid ${kind} step configuration` })
    }
  }
}

export const stepFieldsSchema = stepFieldsBase.superRefine((s, ctx) =>
  refineStep(s, ctx, { requireMessageCopy: true }),
)
export type StepFields = z.infer<typeof stepFieldsBase>

// PATCH accepts any subset.
export const stepPatchSchema = stepFieldsBase
  .partial()
  .superRefine((s, ctx) => refineStep(s, ctx, { requireMessageCopy: false }))

// A sensible default when a trainer taps "Add message".
export const DEFAULT_STEP_FIELDS: StepFields = {
  kind: 'MESSAGE',
  actor: 'CLIENT',
  trigger: null,
  blocking: false,
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
export const stepCreateSchema = stepFieldsBase.partial()

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

/**
 * One (possibly partial) step patch, ready for Prisma.
 *
 * Two things the routes must not each remember: the staff-only-in-app rule, and
 * that `payload` arrives as `unknown` off the wire and has to be narrowed before
 * a Json column will take it. A patch that mentions neither is passed straight
 * through, so a PATCH of just `{ enabled: false }` still writes one field.
 *
 * NOTE for phase 2: CLEARING a payload needs `Prisma.DbNull`, which is a
 * runtime import and cannot live in this module (the editor is a client
 * component). Until a step type can be un-configured, null means "unchanged".
 */
export function stepWriteData<T extends object>(
  fields: T,
  currentAudience: Audience = 'ENROLLED',
  currentChannels: Channel[] = [],
): Omit<T, 'payload'> & { channels?: Channel[]; payload?: Prisma.InputJsonValue } {
  type Out = Omit<T, 'payload'> & { channels?: Channel[]; payload?: Prisma.InputJsonValue }
  const { payload } = fields as T & { payload?: unknown }
  // A patch that mentions neither the channels nor the payload comes back as
  // the SAME object, so a PATCH of one field still writes one field.
  if (payload === undefined) return normalizeStepChannels(fields, currentAudience, currentChannels) as Out
  const { payload: _payload, ...rest } = fields as T & { payload?: unknown }
  void _payload
  return {
    ...normalizeStepChannels(rest, currentAudience, currentChannels),
    payload: payloadForWrite(payload),
  } as Out
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
