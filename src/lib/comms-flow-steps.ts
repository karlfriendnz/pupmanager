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
// Phase 1 left these open (`.catchall`) because nothing could create one yet.
// Phase 2 makes each one REAL, and three rules hold across all six:
//
//   1. NO `.default()`, anywhere. A default materialises a key on the way in,
//      so what a trainer saved and what comes back differ by whatever the
//      schema decided to add. Absent means absent; the fallbacks live in the
//      `…SpecFor()` resolvers below, which are the only things allowed to know
//      what "not set" means. That is what makes save → reload → identical true
//      (AGENTS.md bug #1) rather than nearly true.
//   2. NOTHING that already has a column. `blocking` is the column that says a
//      step waits — a `blocksProgress` in the JSON would be the same
//      two-columns-one-fact trap the `trigger`/`direction` split was written to
//      avoid, and the two WOULD drift the first time a PATCH touched one.
//   3. Unknown keys are DROPPED, not rejected. z.object strips by default, so a
//      payload written by a later phase reads back as the fields this version
//      knows instead of failing a trainer's save outright.
//
// Every field is optional: a trainer adds a step and then configures it, so
// "not configured yet" has to be storable. What stops an unconfigured step
// running is `flowStepConfigProblem()`, not the parser.

/** Where an UPLOAD step's files land. */
export const uploadTargetEnum = z.enum([
  // The dog's own photo — the thing Karl asked for ("upload dog image").
  'DOG_PHOTO',
  // Anything else: a vaccination card, a vet letter, a photo of the garden.
  // Kept with the completion, not written onto a record.
  'ATTACHMENT',
])
export type UploadTarget = z.infer<typeof uploadTargetEnum>

/** What may be attached — mirrors the FILE_UPLOAD question's own `accept`. */
export const uploadAcceptEnum = z.enum(['IMAGE', 'ANY'])
export type UploadAccept = z.infer<typeof uploadAcceptEnum>

/** Preparation, or practice — the same two values as Prisma's HomeworkTiming. */
export const homeworkTimingEnum = z.enum(['BEFORE_SESSION', 'AFTER_SESSION'])

/**
 * FORM — "fill this in".
 *
 * `formId` names one of the trainer's own unified Forms. It is optional here
 * and required by `flowStepConfigProblem` for the same reason every other field
 * is: a half-built step must be savable, and an unconfigured one must not run.
 * Tenant ownership of the id is the ROUTE's job, never this schema's.
 */
export const formStepPayloadSchema = z.object({
  formId: z.string().min(1).optional(),
  /** The words on the button. Absent = "Open the form". */
  ctaLabel: z.string().trim().min(1).max(60).optional(),
})

/**
 * UPLOAD — "send us a picture of Bailey".
 *
 * `target` is where it LANDS and is the whole difference between a dog photo
 * and a general attachment; `accept`/`maxMb`/`minCount`/`maxCount` are what the
 * client is allowed to send. The size cap is checked server-side at upload —
 * a browser-side limit is not a limit (AGENTS.md bug #3).
 */
export const uploadStepPayloadSchema = z
  .object({
    target: uploadTargetEnum.optional(),
    accept: uploadAcceptEnum.optional(),
    /** What is being asked for, in the trainer's words. */
    label: z.string().trim().min(1).max(200).optional(),
    minCount: z.number().int().min(1).max(20).optional(),
    maxCount: z.number().int().min(1).max(20).optional(),
    maxMb: z.number().int().min(1).max(20).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.minCount !== undefined && p.maxCount !== undefined && p.minCount > p.maxCount) {
      ctx.addIssue({ code: 'custom', path: ['maxCount'], message: 'Ask for at least as many as you require' })
    }
    // A dog photo is one photo of a dog. Letting it be a PDF would put a
    // document where every screen renders an <img>.
    if (p.target === 'DOG_PHOTO' && p.accept === 'ANY') {
      ctx.addIssue({ code: 'custom', path: ['accept'], message: 'A dog photo has to be an image' })
    }
  })

/**
 * TASK — homework, handed out by the flow instead of by hand.
 *
 * Deliberately the SAME shape as PackageDefaultTask: a library item read live
 * (so editing the library keeps every flow current) OR an inline one-off, and
 * a `timing` that belongs to this step rather than to the library item. On
 * execution it becomes an ordinary TrainingTask snapshot, exactly as
 * `assignDefaults` already makes one — there is no second kind of to-do in this
 * app and this must not invent one.
 */
export const taskStepPayloadSchema = z
  .object({
    libraryTaskId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(8000).nullable().optional(),
    repetitions: z.number().int().min(1).max(1000).nullable().optional(),
    videoUrl: z.string().max(500).nullable().optional(),
    timing: homeworkTimingEnum.optional(),
  })
  .superRefine((p, ctx) => {
    // A library-backed default reads its text THROUGH the item (see
    // suggestedHomeworkForSession), so an inline title alongside one is a
    // second answer to "what is this called" that nothing would ever read.
    if (p.libraryTaskId && p.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'A library task is named by the library item' })
    }
  })

/**
 * ACCOUNT — "set a password".
 *
 * The step that turns an enquiry into a login. lib/form-continuation.ts is the
 * hard-coded version of it; the shape here is what that flow needs to be
 * expressible — how they prove who they are, and where they land afterwards.
 */
export const accountStepPayloadSchema = z.object({
  method: z.enum(['PASSWORD', 'MAGIC_LINK']).optional(),
  /** An in-app path only. An absolute URL here would be an open redirect. */
  redirectTo: z.string().max(200).regex(/^\/(?!\/)/, 'Must be a path within the app').optional(),
})

/** CHOOSE_OFFERING — "pick what you'd like to book". */
export const chooseOfferingStepPayloadSchema = z.object({
  /** Which offerings they may pick from. Empty/absent = everything published. */
  packageIds: z.array(z.string().min(1)).max(100).optional(),
  allowMultiple: z.boolean().optional(),
  /** Do they pick a TIME too, or just the offering? */
  requireTime: z.boolean().optional(),
})

/**
 * APPROVAL — the step the OTHER SIDE does.
 *
 * "the trainer gets a notification, the trainer accepts the time or moves the
 * time" (Karl). `decides` says what is being accepted so the notification can
 * name it; `autoApproveHours` is the escape hatch for a trainer on holiday, so
 * a blocking approval can't strand a client for ever.
 */
export const approvalStepPayloadSchema = z.object({
  decides: z.enum(['BOOKING_TIME', 'ENROLMENT', 'UPLOAD', 'FORM']).optional(),
  allowReschedule: z.boolean().optional(),
  autoApproveHours: z.number().int().min(1).max(720).optional(),
})

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

/** One kind's payload type, on its own — `FlowStepPayloadOf<'UPLOAD'>`. */
export type FlowStepPayloadOf<K extends FlowStepKind> = Extract<FlowStepPayload, { kind: K }>['payload']

/**
 * Parse a stored payload against the kind on the row. Throws on a mismatch.
 *
 * Generic in the kind so `parseFlowStepPayload('UPLOAD', …).payload` is an
 * upload payload rather than the union of all seven — a caller that has to
 * narrow it by hand ends up casting, and a cast is how the wrong payload gets
 * read as the right one.
 */
export function parseFlowStepPayload<K extends FlowStepKind>(
  kind: K,
  payload: unknown,
): { kind: K; payload: FlowStepPayloadOf<K> } {
  // A null payload on a non-message step is "not configured yet", not invalid —
  // a trainer adds the step, then fills it in.
  const value = kind === 'MESSAGE' ? null : (payload ?? {})
  return { kind, payload: PAYLOAD_SCHEMA_BY_KIND[kind].parse(value) as FlowStepPayloadOf<K> }
}

/** Same, but a stored row that has gone bad reads as unconfigured rather than
 *  throwing into a cron tick that is delivering everybody else's reminders. */
export function safeFlowStepPayload<K extends FlowStepKind>(
  kind: K,
  payload: unknown,
): { kind: K; payload: FlowStepPayloadOf<K> } {
  try {
    return parseFlowStepPayload(kind, payload)
  } catch {
    return { kind, payload: (kind === 'MESSAGE' ? null : {}) as FlowStepPayloadOf<K> }
  }
}

// ─── What "not set" means ───────────────────────────────────────────────────
// The schemas carry no defaults (see above), so exactly one place is allowed to
// say what an absent field falls back to. Everything that renders or executes an
// UPLOAD or a TASK step goes through these, so the client's screen and the
// server's size check cannot disagree about what was asked for.

export interface UploadSpec {
  target: UploadTarget
  accept: UploadAccept
  label: string | null
  minCount: number
  maxCount: number
  maxMb: number
}

/** The upload actually being asked for, absences filled in. */
export function uploadSpecFor(payload: z.infer<typeof uploadStepPayloadSchema> | null | undefined): UploadSpec {
  const p = payload ?? {}
  const target = p.target ?? 'ATTACHMENT'
  const maxCount = p.maxCount ?? 1
  return {
    target,
    // A dog photo is a photo. Anything else may be a document too.
    accept: p.accept ?? (target === 'DOG_PHOTO' ? 'IMAGE' : 'ANY'),
    label: p.label ?? null,
    minCount: Math.min(p.minCount ?? 1, maxCount),
    maxCount,
    // 10 MB matches /api/upload/image. Bigger than that and the serverless
    // request body gives out before any of our checks run.
    maxMb: p.maxMb ?? 10,
  }
}

/** The homework a TASK step hands out, absences filled in. `libraryTaskId` set
 *  means the text is read LIVE from the item and the inline fields are ignored,
 *  exactly as PackageDefaultTask behaves. */
export function taskSpecFor(payload: z.infer<typeof taskStepPayloadSchema> | null | undefined): {
  libraryTaskId: string | null
  title: string | null
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  timing: 'BEFORE_SESSION' | 'AFTER_SESSION'
} {
  const p = payload ?? {}
  return {
    libraryTaskId: p.libraryTaskId ?? null,
    title: p.title ?? null,
    description: p.description ?? null,
    repetitions: p.repetitions ?? null,
    videoUrl: p.videoUrl ?? null,
    // Practice after the session, same default as PackageDefaultTask.timing.
    timing: p.timing ?? 'AFTER_SESSION',
  }
}

/**
 * Why this step cannot run yet — or null when it is ready.
 *
 * The parser deliberately accepts a half-built step, because a trainer adds one
 * and then configures it. This is the other half of that bargain: the engine
 * asks here before it does anything, so an unconfigured step is a step that
 * quietly waits rather than a FORM notification with no form on the end of it.
 */
export function flowStepConfigProblem(step: {
  kind: FlowStepKind
  payload?: unknown
  title?: string | null
  body?: string | null
}): string | null {
  // Narrowed one branch at a time rather than destructured up front: `kind` and
  // `payload` are two variables, and a switch on one tells the compiler nothing
  // about the other.
  const kind = step.kind
  switch (kind) {
    case 'MESSAGE':
      // Same rule the schema enforces on save, restated for a row that predates
      // it or was written by hand.
      if (!step.title?.trim() || !step.body?.trim()) return 'This message has no copy'
      return null
    case 'FORM':
      return safeFlowStepPayload(kind, step.payload).payload.formId ? null : 'No form chosen'
    case 'TASK': {
      const task = safeFlowStepPayload(kind, step.payload).payload
      return task.libraryTaskId || task.title?.trim() ? null : 'No task chosen'
    }
    case 'UPLOAD':
    case 'ACCOUNT':
    case 'CHOOSE_OFFERING':
    case 'APPROVAL':
      // Every field on these has a sensible fallback, so an unconfigured one is
      // still a step that means something.
      return null
    default: {
      const unhandled: never = kind
      return `Unknown step type: ${String(unhandled)}`
    }
  }
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

/**
 * The starting shape for one kind of step.
 *
 * A MESSAGE starts with copy in it, because a trainer adding one is about to
 * write a reminder. Every other kind starts with NO copy: seeding "Reminder
 * from {{business}}" onto a FORM step would put a stray title on a row whose
 * whole point is that it has none, and the first thing to read it would be a
 * client's inbox.
 */
export function defaultsForKind(kind: FlowStepKind, base: StepFields = DEFAULT_STEP_FIELDS): StepFields {
  if (kind === 'MESSAGE') return { ...base, kind }
  return {
    ...base,
    kind,
    title: null,
    body: null,
    emailBody: null,
    // A step a person has to DO is a step the next one waits for. That is the
    // difference between a journey and a pile of independent nudges — and it is
    // the trainer's to turn off, not ours to leave off.
    blocking: true,
    // Fires the moment its anchor comes round; a form to fill in has no lead
    // time to count down the way a reminder does.
    offsetMinutes: 0,
    payload: null,
  }
}

export function withDefaults(partial: Partial<StepFields>): StepFields {
  return { ...defaultsForKind(partial.kind ?? 'MESSAGE'), ...partial }
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
  return { ...defaultsForKind(partial.kind ?? 'MESSAGE', DEFAULT_MEMBERSHIP_STEP_FIELDS), ...partial }
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
