// Shared input validation + defaults for comms-flow steps, used by the CRUD
// routes, the apply-template route and the save-template route so they never
// drift. (Send-side logic lives in comms-flows.ts; the flow-engine primitives —
// trigger resolution, sequencing, the completion ledger — live in flow-steps.ts.)
import { z } from 'zod'
// Type-only, so it is erased before this module reaches the browser (the
// comms-flow editor is a 'use client' component and imports from here).
import type { Prisma } from '@/generated/prisma'

export const channelEnum = z.enum(['PUSH', 'EMAIL', 'IN_APP'])
// BEFORE/DURING/AFTER_SESSION are for offerings with a timetable; the PURCHASE
// and PERIOD_END anchors are for memberships, which have no sessions.
// ON_ENROLMENT is for the same offerings as the SESSION three, but anchors on
// somebody JOINING rather than on any one of their sessions.
export const directionEnum = z.enum([
  'BEFORE_SESSION',
  'DURING_SESSION',
  'AFTER_SESSION',
  'ON_ENROLMENT',
  'AFTER_PURCHASE',
  'BEFORE_PERIOD_END',
])
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
  'DURING_SESSION',
  'AFTER_SESSION',
  'ON_ENROLMENT',
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

// ─── A step does ONE thing ──────────────────────────────────────────────────
//
// Karl, looking at the "Give them homework" editor, which was asking him for
// push/email channels and a message to write: "i don't think we need
// notifications if people are doing homework or forms this should be its own
// step".
//
// So assigning homework is one step, sending a form is one step, and TELLING
// somebody about it is a different step — a MESSAGE the trainer adds if they
// want one. The two sit next to each other on the timeline.

/**
 * Does this kind of step SEND a notification of its own?
 *
 * False for the three kinds that ARE an action: FORM, UPLOAD and TASK. They
 * still land — the homework becomes a real TrainingTask on /my-homework, the
 * form is opened at /form/<id>, a dog photo at /my-dogs — and the client's
 * in-app feed still gets a row so the thing is findable (see
 * `deliveryChannelsFor`). What stops is the push and the email.
 *
 * True for MESSAGE (that IS the step) and for the three journey kinds, whose
 * notification is the only way anybody learns they have to do them: there is no
 * "an account you have not set up yet" screen to discover it on.
 */
export function stepSendsNotification(kind: FlowStepKind): boolean {
  switch (kind) {
    case 'FORM':
    case 'UPLOAD':
    case 'TASK':
      return false
    case 'MESSAGE':
    case 'ACCOUNT':
    case 'CHOOSE_OFFERING':
    case 'APPROVAL':
      return true
    default: {
      // A kind added to the enum and not answered for here is a compile error,
      // not a step that quietly starts emailing people.
      const unhandled: never = kind
      void unhandled
      return true
    }
  }
}

/**
 * The channels a step ACTUALLY delivers on, whatever its row happens to store.
 *
 * The `channels` column is not cleared for the three silent kinds and must not
 * be: a step switched from a form to a message would otherwise come back with
 * nothing to send on, and a trainer's "push + email" would be gone for good.
 * The column stays where it is and this decides what it means — one place, read
 * by the engine, so a row configured before this rule cannot go on sending.
 *
 * IN_APP rather than nothing, deliberately. A silently-assigned piece of
 * homework nobody ever sees is a worse outcome than the noisy version: the feed
 * row is what makes the thing findable in the app, and it neither buzzes a
 * phone nor lands in an inbox. It is also the one channel `deliver()` writes
 * without consulting a mute, which is right — the feed is the app, not a push.
 */
export function deliveryChannelsFor<T extends string>(kind: FlowStepKind, channels: T[]): T[] {
  return stepSendsNotification(kind) ? channels : (['IN_APP'] as unknown as T[])
}

// ─── What may be waited for ─────────────────────────────────────────────────

/**
 * Can the app actually tell when somebody has FINISHED this step?
 *
 * `blocking` is a wall: `availableSteps` offers nothing past an unfinished
 * blocking step, and the only thing that takes a wall down is a
 * FlowStepCompletion row. So a blocking step nothing writes a completion for is
 * not "a step that waits" — it is a journey that stops dead, with the person on
 * the far side of it never hearing from anybody again.
 *
 * This is the single place that fact lives — the builder, the API and the
 * summary line all read it, so a kind opens up in ONE edit.
 *
 * Ticked off today, and by what:
 *
 *   ACCOUNT — `completeAccountStepForEnquiry`, when the continuation token is
 *             spent (phase 3).
 *   FORM    — the form's own submit routes (`/api/my/intake-form/submit` and
 *             `/api/form/[formId]/submit`), via lib/flow-completions.
 *   TASK    — `/api/tasks/[taskId]/complete`, when the client ticks it off.
 *   UPLOAD  — `/api/dogs/[dogId]/photo`, when the picture lands on the dog.
 *
 * UPLOAD is the one kind whose answer depends on its CONFIGURATION rather than
 * its kind, which is why this takes the payload. `target: 'DOG_PHOTO'` is asked
 * for on /my-dogs and lands on a real column, so the app knows when it arrives.
 * An ATTACHMENT has no screen of its own to arrive on — a vet letter asked for
 * by a flow is sent by email or handed over at the class, and nothing in this
 * app sees it happen. Letting one block would be exactly the dead gate this
 * function exists to prevent.
 */
export function canWaitForCompletion(kind: FlowStepKind, payload?: unknown): boolean {
  switch (kind) {
    case 'ACCOUNT':
    case 'FORM':
    case 'TASK':
      return true
    case 'UPLOAD':
      // Read through uploadSpecFor, never off the raw JSON: "no target set"
      // means ATTACHMENT, and that default lives in exactly one place.
      return uploadSpecFor(safeFlowStepPayload('UPLOAD', payload).payload).target === 'DOG_PHOTO'
    case 'MESSAGE':
      // Nothing to finish — a message is delivered, not answered.
      return false
    case 'CHOOSE_OFFERING':
    case 'APPROVAL':
      // Asked for, and nothing yet records the answer coming back. Opening
      // either up is a recorder on the route that takes the decision, plus a
      // case here.
      return false
    default: {
      // A kind added to the enum and not answered for here is a compile error,
      // not a wall nobody can take down.
      const unhandled: never = kind
      void unhandled
      return false
    }
  }
}

/**
 * Can this step hold up the BOOKING itself?
 *
 * Karl's three stages are "before they confirm, during the session, after the
 * session". `direction` says the last two. This is the first, and it is a
 * different kind of fact — not a time, but a condition on the booking going
 * ahead at all.
 *
 * Only a FORM qualifies, and only on an offering-anchored flow (a Package or a
 * ClassRun), which is where a booking exists to hold up. A person-anchored
 * journey already has `blocking` for sequencing, and a membership has no slot to
 * hold. A FORM step also has to NAME a form: a gate with nothing to answer is a
 * wall with no door, which is the exact trap `canWaitForCompletion` exists to
 * avoid on the other axis.
 */
export function canGateBooking(
  kind: FlowStepKind,
  anchor: 'SESSION' | 'PURCHASE' | 'PERSON',
  payload?: unknown,
): boolean {
  if (kind !== 'FORM') return false
  if (anchor !== 'SESSION') return false
  return !!safeFlowStepPayload('FORM', payload).payload.formId
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
  // "Ask this before they can confirm the booking." FORM steps only — see
  // canGateBooking and lib/booking-gate.
  gatesBooking: z.boolean().default(false),
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
  s: { kind?: FlowStepKind; title?: string | null; body?: string | null; payload?: unknown; gatesBooking?: boolean },
  ctx: z.RefinementCtx,
  { requireMessageCopy }: { requireMessageCopy: boolean },
): void {
  const kind = s.kind ?? 'MESSAGE'
  // A gate is a FORM in front of a booking. Nothing else can be one: a message
  // has nothing to answer, and an upload or a task has no way to say "this is
  // complete" at the instant somebody is tapping Confirm. Refused rather than
  // ignored, because a trainer who thinks they have set a gate and hasn't is
  // worse off than one who is told the step can't be one.
  if (s.gatesBooking && kind !== 'FORM') {
    ctx.addIssue({ code: 'custom', path: ['gatesBooking'], message: 'Only a form can hold up a booking' })
  }
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

/**
 * Only the fields the caller ACTUALLY SENT.
 *
 * `.partial()` makes a key optional; it does NOT remove its `.default()`. So
 * `stepPatchSchema.parse({ enabled: false })` comes back carrying
 * `kind: 'MESSAGE'`, `actor: 'CLIENT'` and `blocking: false` — three facts the
 * caller never stated. Written straight to Prisma, flicking a FORM step's
 * on/off switch would quietly turn it into a message step, with its payload
 * still in the column and nothing to read it.
 *
 * Harmless while every row was a MESSAGE authored by a CLIENT, which is why it
 * survived phases 1 and 2. It stops being harmless the moment a flow can hold
 * anything else, so the filter lives here — one place, used by every route that
 * patches a step.
 */
export function sentFieldsOnly<T extends object>(raw: unknown, parsed: T): Partial<T> {
  if (!raw || typeof raw !== 'object') return {}
  const sent = new Set(Object.keys(raw as Record<string, unknown>))
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<T>
}

// A sensible default when a trainer taps "Add message".
export const DEFAULT_STEP_FIELDS: StepFields = {
  kind: 'MESSAGE',
  actor: 'CLIENT',
  trigger: null,
  blocking: false,
  gatesBooking: false,
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

// NOTE: the lead time a step STARTS on now belongs to its STAGE, not to its
// direction — see `flowStageAdd` in lib/flow-timeline.ts. The sheet no longer
// lets a trainer switch direction (a step is added into a stage instead), so
// there is no "switching to this direction" moment left for a per-direction
// default to describe.

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

// ─── A journey's steps ───────────────────────────────────────────────────────
// A Form's flow is PERSON-anchored: it starts when somebody submits the form
// and every step after that is unlocked by finishing the one before. There is
// no clock, so `offsetMinutes` means nothing and `direction` is inert — the
// trigger column is what carries the anchor (see flowTriggerFor).
export const DEFAULT_FORM_STEP_FIELDS: StepFields = {
  ...DEFAULT_STEP_FIELDS,
  trigger: 'ON_ENQUIRY_SUBMITTED',
  offsetMinutes: 0,
  // A journey's steps are sequential by nature: the point of "then this" is
  // that it comes after. The trainer can still switch it off per step.
  blocking: true,
  // A journey has no cohort — the audience is the one person walking it.
  audience: 'CUSTOM',
  title: 'Thanks for getting in touch',
  body: "Hi {{name}}, thanks for your enquiry — here's what happens next.",
}

/**
 * One step of a journey, defaults filled in.
 *
 * The trigger is FORCED to a person trigger rather than defaulted, because the
 * anchor is not the trainer's to get wrong: a step hanging off a Form with
 * `trigger: null` would read as BEFORE_SESSION, land in the cron's scan, and
 * fire against a timetable the form does not have.
 */
export function withFormDefaults(partial: Partial<StepFields>): StepFields {
  const kind = partial.kind ?? 'MESSAGE'
  const base = defaultsForKind(kind, DEFAULT_FORM_STEP_FIELDS)
  const merged = { ...base, ...partial }
  return {
    ...merged,
    trigger: personTriggerEnum.safeParse(partial.trigger).success
      ? (partial.trigger as PersonTrigger)
      : 'ON_ENQUIRY_SUBMITTED',
    // A wall only comes down when a FlowStepCompletion is written.
    // `defaultsForKind` turns blocking ON for every kind a person has to DO —
    // right in principle, and a permanent stall in practice for the kinds
    // nothing ticks off. See canWaitForCompletion.
    blocking: canWaitForCompletion(kind, merged.payload) && (partial.blocking ?? merged.blocking),
  }
}

/**
 * What `blocking` must be on a form step after a patch — or undefined to leave
 * the column alone.
 *
 * Two jobs, and the second is the one that isn't obvious:
 *
 *   1. Whatever the browser sends, a step that cannot be finished cannot be
 *      waited for. Validation in the browser is not validation (AGENTS.md #3).
 *   2. A step that COULD be waited for and then stopped — an UPLOAD switched
 *      from "a photo of their dog" to "a file" — has its wall taken down in the
 *      same write. Without this the payload edit succeeds, the toggle
 *      disappears from the builder, and the wall it left behind is one nothing
 *      can ever take down: a journey stopped dead by a switch the trainer can
 *      no longer see.
 *
 * `payload` is what the row will hold AFTER the patch, and `currentBlocking`
 * what it says today — so a patch mentioning neither returns undefined and
 * writes nothing.
 */
export function formStepBlocking(args: {
  kind: FlowStepKind
  payload?: unknown
  blocking?: boolean
  currentBlocking: boolean
}): boolean | undefined {
  const wanted = args.blocking ?? args.currentBlocking
  const allowed = canWaitForCompletion(args.kind, args.payload) && wanted
  return allowed === args.currentBlocking ? undefined : allowed
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
  // Enrolling happens before any of the sessions enrolled for, whatever lead
  // time the run-up reminders carry — the cap on offsetMinutes is 60 days, so a
  // million minutes of clearance can never be closed by a stray value.
  if (s.direction === 'ON_ENROLMENT') return -1_000_000 + s.offsetMinutes
  // The session itself is zero on this number line, and a "during" step happens
  // AT it — its offsetMinutes is not a lead time and must not move it (see the
  // enum comment in schema.prisma). It ties with "right on" either side, and
  // `order` breaks the tie, exactly as those two already tie with each other.
  if (s.direction === 'DURING_SESSION') return 0
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
