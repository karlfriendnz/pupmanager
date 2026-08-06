// Automated communication flows for classes / drop-ins / events.
//
// A trainer builds a flow of timed messages on a ClassRun — "3 days before →
// push", "15 min before → push", "2 hours after → in-app". Every group offering
// (class, drop-in, event) materialises as a ClassRun with TrainingSessions, so
// the flow lives on the run. The comms-flows cron (`processCommsFlows`) scans
// sessions every 5 minutes and delivers each due step once per recipient.
//
// Delivery respects each client's channel opt-out (User.notifyPush /
// User.productEmailOptOut) UNLESS the step is marked `important` (cancellations,
// venue changes), which always delivers. The in-app feed row is the source of
// truth; push/email are best-effort.
import { prisma } from './prisma'
import { sendPush } from './push'
import { sendEmail, fromTrainer } from './email'
import { richTextToPlain } from './rich-text'
import { renderClientNotificationEmail } from './client-notification-email'
import { notifyTrainer } from './trainer-notify'
import { isCronRunnable, availableSteps, advanceFlowRun } from './flow-steps'
import {
  safeFlowStepPayload,
  flowStepConfigProblem,
  uploadSpecFor,
  taskSpecFor,
  type FlowStepKind,
  type FlowStepActor,
} from './comms-flow-steps'
import { bookingAnswerExists } from './booking-gate'
import type { NotificationChannel } from '@/generated/prisma'

// Placeholders a trainer can drop into a step's title/body.
export const COMMS_PLACEHOLDERS = [
  '{{name}}', '{{dog}}', '{{time}}', '{{date}}', '{{class}}', '{{business}}', '{{location}}',
] as const

// A membership has no session, so time/date/location have nothing to say.
//
// Trainer-facing copy calls these "Packages" now, so the token offered for
// insertion is `{{package}}`. `{{membership}}` is the SAME value under its
// pre-rename spelling and is substituted for ever: CommsFlowStep rows written
// before the rename hold that literal string, and a trainer can still type it.
// Renaming without keeping the alias would print "{{membership}}" verbatim to a
// client — which is why the alias lands with (not after) the backfill in
// migration 20260727200000_comms_flow_package_token.
export const MEMBERSHIP_PLACEHOLDERS = [
  '{{name}}', '{{dog}}', '{{package}}', '{{business}}', '{{date}}',
] as const

/** The pre-rename spelling of `{{package}}`. Accepted, never offered. */
export const LEGACY_MEMBERSHIP_TOKEN = '{{membership}}'

export interface CommsVars {
  name: string
  dog: string
  time: string
  date: string
  class: string
  business: string
  location: string
  /** Membership steps only — the bundle they bought. */
  membership?: string
}

function fill(template: string, vars: CommsVars): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/g, vars.name)
    .replace(/\{\{\s*dog\s*\}\}/g, vars.dog)
    .replace(/\{\{\s*time\s*\}\}/g, vars.time)
    .replace(/\{\{\s*date\s*\}\}/g, vars.date)
    .replace(/\{\{\s*class\s*\}\}/g, vars.class)
    .replace(/\{\{\s*business\s*\}\}/g, vars.business)
    .replace(/\{\{\s*location\s*\}\}/g, vars.location)
    // One value, two spellings. `{{package}}` is what the editor inserts now;
    // `{{membership}}` is what every step saved before the rename contains.
    // Both must fill, or a saved step renders a literal token to a client.
    .replace(/\{\{\s*(?:package|membership)\s*\}\}/g, vars.membership ?? '')
}

/** Render a step's title + body (+ optional rich email body) with the
 *  session/recipient variables filled in.
 *
 *  title/body are NULLABLE since flows widened past messages — a FORM or UPLOAD
 *  step has no copy at all. They collapse to an empty string here rather than
 *  being interpolated: `String(null)` is the four characters "null", and the
 *  one place that would ever be visible is the subject line of a real client's
 *  email. */
export function renderCommsMessage(
  step: { title: string | null; body: string | null; emailBody?: string | null },
  vars: CommsVars,
): { title: string; body: string; emailBody: string | null } {
  return {
    title: fill(step.title ?? '', vars),
    body: fill(step.body ?? '', vars),
    emailBody: step.emailBody ? fill(step.emailBody, vars) : null,
  }
}

function fmtTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

function fmtDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(date)
}

const DAY_MS = 86_400_000

// A starter flow offered when a trainer first opens the editor: a friendly
// day-before nudge + a 15-minute heads-up. Trainers tweak or delete freely.
export const COMMS_STARTER_STEPS = [
  {
    direction: 'BEFORE_SESSION' as const,
    offsetMinutes: 1440,
    channels: ['PUSH', 'EMAIL'] as NotificationChannel[],
    important: false,
    title: 'See you tomorrow, {{name}} 🐾',
    body: "Reminder: {{dog}}'s {{class}} is on {{date}} at {{time}}. See you then!",
  },
  {
    direction: 'BEFORE_SESSION' as const,
    offsetMinutes: 15,
    channels: ['PUSH'] as NotificationChannel[],
    important: false,
    title: 'Starting soon',
    body: '{{class}} starts at {{time}} — see you shortly!',
  },
]

// The starter flow offered on a MEMBERSHIP, which has no sessions: a welcome
// the moment they join, then a check-in a week later.
export const MEMBERSHIP_STARTER_STEPS = [
  {
    direction: 'AFTER_PURCHASE' as const,
    offsetMinutes: 0,
    channels: ['PUSH', 'EMAIL'] as NotificationChannel[],
    important: false,
    title: 'Welcome to {{package}}, {{name}} 🎉',
    body: "You're all set. Everything included is ready to book in the app — see you soon!",
  },
  {
    direction: 'AFTER_PURCHASE' as const,
    offsetMinutes: 7 * 24 * 60,
    channels: ['PUSH'] as NotificationChannel[],
    important: false,
    title: 'How’s it going, {{name}}?',
    body: "Hope you and {{dog}} are enjoying {{package}}. Anything you need, just message us.",
  },
]

interface RecipientUser {
  id: string
  name: string | null
  // Null when the client has no address. The EMAIL channel already checks it
  // before sending; push and in-app notifications do not need one.
  email: string | null
  notifyPush: boolean
  productEmailOptOut: boolean
}

interface TrainerBrand {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
  // timezone comes back from TRAINER_BRAND_SELECT and is what dates are
  // formatted in; optional because the email renderer doesn't need it.
  user: { name: string | null; email: string | null; timezone?: string | null }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://app.pupmanager.com'

/**
 * Deliver one rendered message to one recipient across the step's channels.
 * IN_APP always writes the feed row; PUSH/EMAIL are gated by the client's
 * opt-outs unless the step is `important`. Best-effort per channel.
 */
async function deliver(args: {
  channels: NotificationChannel[]
  important: boolean
  user: RecipientUser
  trainer: TrainerBrand
  title: string
  body: string
  emailBody: string | null
  link: string
}): Promise<void> {
  const { channels, important, user, trainer, title, body, emailBody, link } = args

  if (channels.includes('IN_APP')) {
    await prisma.notification
      .create({ data: { userId: user.id, title, body, link } })
      .catch(err => console.error('[comms-flows] in-app failed', err))
  }

  if (channels.includes('PUSH') && (important || user.notifyPush)) {
    await sendPush(user.id, { alert: { title, body }, customData: { path: link } }).catch(err =>
      console.error('[comms-flows] push failed', err),
    )
  }

  if (channels.includes('EMAIL') && (important || !user.productEmailOptOut) && user.email) {
    const email = renderClientNotificationEmail({
      trainer,
      title,
      // Rich email body when authored; else the plain message. bodyHtml renders
      // the formatted version, body feeds the preview + plain-text part.
      body: emailBody ? richTextToPlain(emailBody) : body,
      bodyHtml: emailBody ?? undefined,
      detail: null,
      description: null,
      ctaLabel: 'Open in PupManager',
      ctaHref: `${APP_URL}${link}`,
    })
    const sent = await sendEmail({
      to: user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      from: fromTrainer(email.displayName),
      replyTo: email.trainerEmail,
    }).catch(e => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
    if (sent && 'error' in sent && sent.error) {
      console.error('[comms-flows] email rejected', { userId: user.id, error: sent.error })
    }
  }
}

// ─── Doing a step ───────────────────────────────────────────────────────────
//
// A step used to be a message, so "process a step" meant "render it and push
// it". It is now one step of a flow, and four kinds of it can come round on a
// clock: a MESSAGE, a FORM to fill in, an UPLOAD to send, a TASK to practise.
//
// All four go out through `deliver()` — the same channels, the same opt-out
// rules, the same email renderer. There is deliberately no second sender: the
// difference between "here's a reminder" and "here's a form" is a link and some
// default copy, and a second path would be a second place for a client's mute
// to be forgotten.

/**
 * Where a step's notification takes them.
 *
 * A TRAINER-actor step always keeps the fallback, which its caller has already
 * made a trainer-side path: /form/<id> and /my-dogs are the CLIENT's screens,
 * and sending a trainer to one is sending them somewhere they cannot act.
 */
export function flowStepLink(
  kind: FlowStepKind,
  payload: unknown,
  fallback: string,
  actor: FlowStepActor = 'CLIENT',
): string {
  if (actor === 'TRAINER') return fallback
  switch (kind) {
    case 'FORM': {
      const formId = safeFlowStepPayload('FORM', payload).payload.formId
      // /form/<id> is the one URL in the app that renders a Form to a person.
      return formId ? `/form/${encodeURIComponent(formId)}` : fallback
    }
    case 'UPLOAD':
      // A dog photo belongs on the dog; anything else is answered where they
      // were asked.
      return uploadSpecFor(safeFlowStepPayload('UPLOAD', payload).payload).target === 'DOG_PHOTO'
        ? '/my-dogs'
        : fallback
    case 'TASK':
      return '/my-homework'
    default:
      return fallback
  }
}

/**
 * The words a non-MESSAGE step goes out with when the trainer wrote none.
 *
 * title/body are nullable precisely because a FORM step has no copy — but a
 * notification still has to say something, and an empty push is worse than a
 * plain one. A trainer who DOES write copy keeps theirs: this only fills in.
 */
export function flowStepCopy(
  step: { kind: FlowStepKind; title: string | null; body: string | null; payload?: unknown },
): { title: string; body: string } {
  if (step.title?.trim() && step.body?.trim()) return { title: step.title, body: step.body }
  switch (step.kind) {
    case 'FORM':
      return {
        title: step.title?.trim() || 'A form to fill in',
        body: step.body?.trim() || '{{business}} needs a few details from you — it only takes a minute.',
      }
    case 'UPLOAD': {
      const spec = uploadSpecFor(safeFlowStepPayload('UPLOAD', step.payload).payload)
      const ask = spec.label ?? (spec.target === 'DOG_PHOTO' ? 'a photo of {{dog}}' : 'a file')
      return {
        title: step.title?.trim() || (spec.target === 'DOG_PHOTO' ? 'A photo of {{dog}}, please' : 'Something to send us'),
        body: step.body?.trim() || `Hi {{name}}, {{business}} has asked for ${ask}.`,
      }
    }
    case 'TASK':
      return {
        title: step.title?.trim() || 'New homework from {{business}}',
        body: step.body?.trim() || "Hi {{name}}, there's something new to practise with {{dog}}.",
      }
    default:
      // A MESSAGE cannot be saved without both, and flowStepConfigProblem holds
      // back a legacy row that has neither, so this is the belt to that braces.
      return { title: step.title ?? '', body: step.body ?? '' }
  }
}

/** Everything one step needs to be executed, however it was driven. */
export interface ExecutableStep {
  id: string
  kind: FlowStepKind
  actor: FlowStepActor
  channels: NotificationChannel[]
  important: boolean
  title: string | null
  body: string | null
  emailBody?: string | null
  payload?: unknown
}

/**
 * Hand out a TASK step's homework.
 *
 * A library-backed step reads its text LIVE from the item at hand-out time and
 * then SNAPSHOTS it onto the TrainingTask — the same two-step dance
 * `suggestedHomeworkForSession` + `assignDefaults` do for an offering's
 * defaults, and for the same reason: editing the library keeps the flow current
 * without rewriting work already given out. There is no second kind of to-do in
 * this app and this must not invent one.
 *
 * Returns false when there is nothing to hand out (a deleted library item, a
 * client we can't place), so the caller doesn't record a send for a task that
 * never landed.
 */
async function assignFlowTask(args: {
  payload: unknown
  clientId: string
  dogId?: string | null
  sessionId?: string | null
  date: Date
}): Promise<boolean> {
  const spec = taskSpecFor(safeFlowStepPayload('TASK', args.payload).payload)
  let { title, description, repetitions, videoUrl } = spec
  if (spec.libraryTaskId) {
    const item = await prisma.libraryTask.findUnique({
      where: { id: spec.libraryTaskId },
      select: { title: true, description: true, repetitions: true, videoUrl: true },
    })
    // The item was deleted out from under the step. Handing out an empty task
    // is worse than handing out none.
    if (!item) return false
    ;({ title, description, repetitions, videoUrl } = item)
  }
  if (!title?.trim()) return false

  // Same de-duplication as assignDefaults: matched on the library item where
  // there is one and on the title otherwise, so a re-run never doubles up even
  // if the send row is missed.
  const existing = await prisma.trainingTask.findMany({
    where: { clientId: args.clientId, sessionId: args.sessionId ?? null },
    select: { title: true, libraryTaskId: true, order: true },
  })
  const dupe = spec.libraryTaskId
    ? existing.some(t => t.libraryTaskId === spec.libraryTaskId)
    : existing.some(t => t.title.toLocaleLowerCase('en-NZ') === title!.toLocaleLowerCase('en-NZ'))
  if (dupe) return false

  await prisma.trainingTask.create({
    data: {
      clientId: args.clientId,
      dogId: args.dogId ?? null,
      sessionId: args.sessionId ?? null,
      date: args.date,
      title,
      description,
      repetitions,
      videoUrl,
      libraryTaskId: spec.libraryTaskId,
      timing: spec.timing,
      order: existing.reduce((max, t) => Math.max(max, t.order), -1) + 1,
    },
  })
  return true
}

/**
 * Do one step, for one recipient.
 *
 * The single place that knows what each kind means, so the cron and a
 * person's run cannot disagree about what a FORM step is. Returns false when
 * the step did nothing — an unconfigured step, or homework that had nowhere to
 * land — so the caller records a send only for something that happened.
 */
export async function executeFlowStep(args: {
  step: ExecutableStep
  user: RecipientUser
  trainer: TrainerBrand
  vars: CommsVars
  link: string
  /** The client + dog a TASK step hands homework to. Absent = nothing to assign. */
  clientId?: string | null
  dogId?: string | null
  sessionId?: string | null
  date?: Date
  /** The business, for a trainer-actor step's notification preferences. */
  companyId?: string | null
}): Promise<boolean> {
  const { step, user, trainer, vars, clientId, dogId, sessionId, date, companyId } = args

  // A half-built step waits. A "fill in this form" notification with no form on
  // the end of it is worse than silence, and this is the one gate that stops
  // one going out (see flowStepConfigProblem).
  //
  // MESSAGE is deliberately EXEMPT. Its copy is checked on save and has been
  // since long before flows widened, so re-checking it here could only change
  // what an existing reminder does — and the one thing this phase must not do
  // is stop a reminder that fires today.
  if (step.kind !== 'MESSAGE' && flowStepConfigProblem(step)) return false

  const copy = flowStepCopy(step)
  const rendered = renderCommsMessage({ ...step, title: copy.title, body: copy.body }, vars)
  const link = flowStepLink(step.kind, step.payload, args.link, step.actor)

  // A TASK step's homework lands first: the notification says there is
  // something new to practise, so it must not go out before there is.
  if (step.kind === 'TASK') {
    if (!clientId) return false
    const assigned = await assignFlowTask({ payload: step.payload, clientId, dogId, sessionId, date: date ?? new Date() })
    if (!assigned) return false
  }

  // ── Who hears about it ────────────────────────────────────────────────────
  // A step whose ACTOR is the trainer is something the trainer has to do inside
  // a client's flow ("accept the time or move it"). It goes to the trainer's
  // own notification surface, with their own per-type preferences — never
  // through deliver(), which is the client's.
  //
  // `user` here is already one of the TRAINER's people: the callers resolve an
  // actor-TRAINER step's recipients through the staff resolver, exactly as they
  // do a STAFF-audience one. Sending a "you need to accept this" to the client
  // it is about would be the whole feature backwards.
  if (step.actor === 'TRAINER') {
    await notifyTrainer(
      user.id,
      'FLOW_STEP_WAITING',
      { clientName: vars.name, title: rendered.title, detail: rendered.body },
      link,
      companyId ?? null,
    )
    return true
  }

  await deliver({
    channels: step.channels,
    important: step.important,
    user,
    trainer,
    title: rendered.title,
    body: rendered.body,
    emailBody: rendered.emailBody,
    link,
  })
  return true
}

/**
 * Cron worker: send every due comms-flow step exactly once per recipient.
 * BEFORE_SESSION fires while now is within `offset` of an upcoming session;
 * AFTER_SESSION fires once now is past session + offset (bounded to 30 days so
 * old sessions never reopen). Dedup is the unique (step, session, user) row.
 */
const TRAINER_BRAND_SELECT = {
  businessName: true, logoUrl: true, emailAccentColor: true,
  user: { select: { name: true, email: true, timezone: true } },
} as const
const RECIPIENT_USER_SELECT = { id: true, name: true, email: true, notifyPush: true, productEmailOptOut: true } as const

/**
 * One recipient of one step, at one anchor.
 *
 * `clientId`/`dogId` ride along because a TASK step has to hand its homework to
 * a ClientProfile and a Dog, not to a User — the notification and the thing it
 * is about go to two different tables. Both are null for a staff recipient,
 * which is exactly why a TASK step assigns nothing to staff.
 */
interface FlowRecipient {
  user: RecipientUser
  dogs: string[]
  clientId: string | null
  dogId: string | null
}
type SessionRecipients = { scheduledAt: Date; byUser: Map<string, FlowRecipient> }

// ─── Who a STAFF step reaches ───────────────────────────────────────────────
// The people working THAT session, and nobody else. A reminder about Tuesday's
// 4pm class has no business on the phone of someone who isn't on it, so there
// is no whole-team fallback. The cascade is:
//
//   1. TrainingSession.assignedTrainer — the member down to take this one
//      session. Drop-in slots snapshot their staffing onto each session they
//      generate (see class-runs.ts), so per-slot staff arrive here too.
//   2. The ClassRunTrainer rows — who is running this class in general. Only
//      class runs have this; a 1:1 package's sessions carry their own.
//   3. The main trainer — the business's own user, plus any other OWNER-role
//      member. Nobody assigned is a gap in the trainer's setup, not a reason to
//      swallow the message: a staff reminder that reaches no one looks like a
//      broken feature and reports itself to nobody.
//
// Note the fallback can't be "the OWNER memberships" alone. A solo or legacy
// trainer may have NO TrainerMembership row at all (see lib/membership.ts, the
// "legacy owner without a membership row yet" branch) — for them that query
// returns nothing, which is the exact silence this is here to prevent. So
// TrainerProfile.user is always in the list, and the two are de-duplicated.
const ASSIGNED_MEMBER_SELECT = { acceptedAt: true, user: { select: RECIPIENT_USER_SELECT } } as const
type AssignedMember = { acceptedAt: Date | null; user: RecipientUser | null } | null | undefined

function dedupeUsers(users: (RecipientUser | null | undefined)[]): RecipientUser[] {
  const byId = new Map<string, RecipientUser>()
  for (const u of users) if (u?.id) byId.set(u.id, u)
  return [...byId.values()]
}

/** An assignment only counts once the member has actually accepted their invite. */
function acceptedUser(member: AssignedMember): RecipientUser | null {
  return member?.acceptedAt && member.user?.id ? member.user : null
}

/**
 * Build the per-session staff resolver for one step. The run-level list and the
 * owners are each fetched at most once per step, then reused for every session.
 */
async function staffResolver(companyId: string, classRunId: string | null) {
  const runLevel = classRunId
    ? dedupeUsers(
        (await prisma.classRunTrainer.findMany({
          where: { classRunId, membership: { acceptedAt: { not: null } } },
          select: { membership: { select: { user: { select: RECIPIENT_USER_SELECT } } } },
        })).map(a => a.membership?.user),
      )
    : []
  let mainTrainers: RecipientUser[] | null = null

  async function resolveMainTrainers(): Promise<RecipientUser[]> {
    const [profile, ownerMembers] = await Promise.all([
      prisma.trainerProfile.findUnique({
        where: { id: companyId },
        select: { user: { select: RECIPIENT_USER_SELECT } },
      }),
      prisma.trainerMembership.findMany({
        where: { companyId, role: 'OWNER', acceptedAt: { not: null } },
        select: { user: { select: RECIPIENT_USER_SELECT } },
      }),
    ])
    // The business's own user first, then any co-owner. dedupeUsers keys by id,
    // so an owner who also holds a membership row is listed once.
    return dedupeUsers([profile?.user, ...ownerMembers.map(m => m.user)])
  }

  return async function forSession(assigned: AssignedMember): Promise<RecipientUser[]> {
    const own = acceptedUser(assigned)
    if (own) return [own]
    if (runLevel.length) return runLevel
    mainTrainers ??= await resolveMainTrainers()
    return mainTrainers
  }
}

export async function processCommsFlows(
  now: Date = new Date(),
): Promise<{ steps: number; sent: number; skipped: number }> {
  const steps = await prisma.commsFlowStep.findMany({
    where: { enabled: true, channels: { isEmpty: false } },
    include: {
      classRun: { select: { name: true, location: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
      package: { select: { name: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
      membership: { select: { name: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
    },
  })

  let sent = 0
  let skipped = 0
  for (const step of steps) {
    // ─── Route by kind ──────────────────────────────────────────────────────
    // A flow step is no longer necessarily a message. Four kinds mean something
    // on a clock — a reminder, a form due before each class, a photo asked for
    // after one, homework handed out with it — and all four run through the
    // path below.
    //
    // The other three (set a password, choose an offering, a trainer accepting)
    // are steps in a PERSON's journey; a class reminder has no business asking
    // anybody to do those, and neither has this scan. Nor has it any business
    // with a person-anchored MESSAGE: that is unlocked by finishing the step
    // before it, so the run sends it — firing it here would send a welcome to
    // somebody who never finished signing up.
    if (!isCronRunnable(step)) {
      skipped++
      continue
    }
    // A step the trainer never finished configuring is passed over before it
    // costs a query, and without recording anything — so it starts working the
    // moment they finish it, rather than being marked delivered for ever.
    // MESSAGE is exempt: see executeFlowStep.
    if (step.kind !== 'MESSAGE' && flowStepConfigProblem(step)) {
      skipped++
      continue
    }

    // Membership steps anchor on a purchase, not a session — different shape
    // entirely, so they run through their own pass.
    if (step.membershipId) {
      if (step.membership) sent += await processMembershipStep(step, step.membership, now)
      continue
    }

    // A step is scoped to a ClassRun (group class / drop-in / event / puppy
    // school) OR a Package (a 1:1 package). Skip a step whose owner was deleted.
    const owner = step.classRunId ? step.classRun : step.packageId ? step.package : null
    if (!owner) continue
    const tz = owner.trainer.user.timezone ?? 'Pacific/Auckland'
    const trainer: TrainerBrand = owner.trainer
    const className = owner.name
    const location = step.classRunId ? (step.classRun?.location ?? '') : ''
    const offsetMs = step.offsetMinutes * 60_000

    const scheduledWhere =
      step.direction === 'BEFORE_SESSION'
        ? { gte: now, lte: new Date(now.getTime() + offsetMs) }
        : { lte: new Date(now.getTime() - offsetMs), gte: new Date(now.getTime() - offsetMs - 30 * DAY_MS) }

    // Build, per session, the map of recipient user → their dog name(s). For a
    // run that comes from its enrolments; for a 1:1 package each session has its
    // own single client.
    const perSession = new Map<string, SessionRecipients>()

    // A staff step is about the session, not about one client's booking: the
    // people working it hear the same thing, with {{dog}} standing in for the
    // dogs booked that day. Resolved per session — the same class can be
    // covered by different people week to week.
    //
    // A step whose ACTOR is the trainer resolves the same way, whatever its
    // audience says. "The trainer accepts the time" is by definition the
    // trainer's to do, and pushing it at the client it is about would be the
    // whole feature backwards.
    const toStaff = step.audience === 'STAFF' || step.actor === 'TRAINER'
    const staffFor = toStaff ? await staffResolver(owner.trainerId, step.classRunId) : null

    if (step.classRunId) {
      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId: step.classRunId, scheduledAt: scheduledWhere },
        select: { id: true, scheduledAt: true, assignedTrainer: { select: ASSIGNED_MEMBER_SELECT } },
      })
      if (sessions.length === 0) continue
      // Everyone on the run in an allowed status (CUSTOM narrows to picked clients).
      const statuses = step.audience === 'ENROLLED_AND_WAITLIST' ? ['ENROLLED', 'WAITLISTED'] : ['ENROLLED']
      const enrollments = await prisma.classEnrollment.findMany({
        where: {
          classRunId: step.classRunId,
          status: { in: statuses as ('ENROLLED' | 'WAITLISTED')[] },
          // Nothing automated goes out about a dog that has died. An enrolment
          // carrying no dog at all is still a real person, so it stays.
          OR: [{ dogId: null }, { dog: { deceasedAt: null } }],
          ...(step.audience === 'CUSTOM' ? { clientId: { in: step.customClientIds } } : {}),
        },
        select: {
          dropInSessionId: true,
          // The client + dog a TASK step hands homework to.
          clientId: true,
          dogId: true,
          dog: { select: { name: true } },
          client: { select: { user: { select: RECIPIENT_USER_SELECT } } },
        },
      })
      for (const s of sessions) {
        // FULL enrolments (dropInSessionId null) attend every session; a drop-in
        // only its one. Dedup by user, collecting their dog name(s).
        const byUser = new Map<string, FlowRecipient>()
        const attending: string[] = []
        for (const e of enrollments) {
          if (e.dropInSessionId && e.dropInSessionId !== s.id) continue
          if (e.dog?.name && !attending.includes(e.dog.name)) attending.push(e.dog.name)
          const u = e.client?.user
          if (!u?.id) continue
          const entry = byUser.get(u.id) ?? { user: u, dogs: [], clientId: e.clientId ?? null, dogId: e.dogId ?? null }
          if (e.dog?.name && !entry.dogs.includes(e.dog.name)) entry.dogs.push(e.dog.name)
          byUser.set(u.id, entry)
        }
        if (staffFor) {
          // Staff hear about the session even when nobody has booked yet. They
          // carry no client/dog: a staff step tells the team about the session,
          // it does not hand anybody homework.
          const staff = await staffFor(s.assignedTrainer)
          if (staff.length) {
            perSession.set(s.id, {
              scheduledAt: s.scheduledAt,
              byUser: new Map(staff.map(u => [u.id, { user: u, dogs: attending, clientId: null, dogId: null }])),
            })
          }
        } else if (byUser.size) {
          perSession.set(s.id, { scheduledAt: s.scheduledAt, byUser })
        }
      }
    } else {
      // 1:1 package: each session belongs to one client. CUSTOM narrows to picked clients.
      const sessions = await prisma.trainingSession.findMany({
        where: {
          clientPackage: { packageId: step.packageId! },
          scheduledAt: scheduledWhere,
          // As above: no automated message about a dog that has died.
          OR: [{ dogId: null }, { dog: { deceasedAt: null } }],
          ...(step.audience === 'CUSTOM' ? { clientId: { in: step.customClientIds } } : {}),
        },
        select: {
          id: true, scheduledAt: true, clientId: true, dogId: true, dog: { select: { name: true } },
          assignedTrainer: { select: ASSIGNED_MEMBER_SELECT },
          client: { select: { user: { select: RECIPIENT_USER_SELECT } } },
        },
      })
      for (const s of sessions) {
        const dogs = s.dog?.name ? [s.dog.name] : []
        if (staffFor) {
          // A 1:1 has no run to fall back on — "assigned to the session" is the
          // session's own trainer, then the owner.
          const staff = await staffFor(s.assignedTrainer)
          if (staff.length) {
            perSession.set(s.id, {
              scheduledAt: s.scheduledAt,
              byUser: new Map(staff.map(u => [u.id, { user: u, dogs, clientId: null, dogId: null }])),
            })
          }
          continue
        }
        const u = s.client?.user
        if (!u?.id) continue
        perSession.set(s.id, {
          scheduledAt: s.scheduledAt,
          byUser: new Map([[u.id, { user: u, dogs, clientId: s.clientId ?? null, dogId: s.dogId ?? null }]]),
        })
      }
    }

    if (perSession.size === 0) continue
    // Staff live on the trainer side of the app, so their link goes to the work,
    // not to a client's session list.
    const link = toStaff ? (step.classRunId ? `/classes/${step.classRunId}` : '/schedule') : '/my-sessions'

    for (const [sessionId, { scheduledAt, byUser }] of perSession) {
      const already = await prisma.commsFlowSend.findMany({ where: { stepId: step.id, sessionId }, select: { userId: true } })
      const alreadySent = new Set(already.map(a => a.userId))
      const vars0 = { time: fmtTime(scheduledAt, tz), date: fmtDate(scheduledAt, tz), class: className, business: trainer.businessName, location }

      for (const [userId, { user, dogs, clientId, dogId }] of byUser) {
        if (alreadySent.has(userId)) continue
        // A gating FORM step is asked AT THE MOMENT OF BOOKING — it is what
        // holds the booking up (lib/booking-gate). Asking again the day before
        // would nag somebody for a form they filled in to get the session in the
        // first place, which is the "booked AND being chased" behaviour this
        // whole feature exists to stop.
        //
        // Skipped WITHOUT recording a send, so a session that reached this step
        // some other way (a trainer booking it on the client's behalf, where the
        // gate deliberately does not apply) is still asked, and keeps being asked
        // until they answer.
        if (step.gatesBooking && step.kind === 'FORM') {
          const formId = safeFlowStepPayload('FORM', step.payload).payload.formId
          if (formId && (await bookingAnswerExists({ formId, sessionId }))) {
            skipped++
            continue
          }
        }
        const vars: CommsVars = { ...vars0, name: user.name ?? 'there', dog: dogs.join(', ') }
        const did = await executeFlowStep({
          step, user, trainer, vars, link,
          clientId, dogId, sessionId, date: scheduledAt, companyId: owner.trainerId,
        })
        // A step that did nothing — never configured, or homework with nowhere
        // to land — records no send, so it runs again once the trainer fixes it
        // rather than being marked delivered for ever.
        if (!did) {
          skipped++
          continue
        }
        // Record the send. Unique (stepId, sessionId, userId) guards a concurrent
        // tick from double-sending — swallow the conflict if it races.
        await prisma.commsFlowSend.create({ data: { stepId: step.id, sessionId, userId } }).catch(() => {})
        sent++
      }
    }
  }

  return { steps: steps.length, sent, skipped }
}

// ─── A person's journey ─────────────────────────────────────────────────────

const RUN_TRAINER_SELECT = { ...TRAINER_BRAND_SELECT } as const

/**
 * Ask a person for whatever their run is currently waiting on.
 *
 * The other half of the engine. A session-anchored flow is scanned statelessly
 * by the cron, which is what lets one tick cover every trainer; a journey is
 * driven from the app, one person at a time, and this is the call the app makes
 * — after the enquiry lands, after they set a password, after each step is
 * ticked off.
 *
 * BLOCKING is the whole point, and it is enforced by `availableSteps`: nothing
 * past an unfinished blocking step is offered, so a run cannot walk past a step
 * whose FlowStepCompletion row does not exist yet. The cursor is recomputed
 * from that same ledger by `advanceFlowRun` — never incremented — so a step
 * added, disabled or deleted underneath a half-finished run can't strand
 * anybody on a step that no longer exists.
 *
 * Idempotent by the (step, run, user) send row, exactly as the cron is by
 * (step, session, user): calling this twice asks once.
 */
export async function processFlowRun(
  runId: string,
  now: Date = new Date(),
): Promise<{ asked: number; waitingOn: string | null; completed: boolean }> {
  const run = await prisma.flowRun.findUnique({
    where: { id: runId },
    select: {
      id: true, trainerId: true, formId: true, packageId: true, userId: true, clientId: true, status: true,
      trainer: { select: RUN_TRAINER_SELECT },
      user: { select: RECIPIENT_USER_SELECT },
    },
  })
  // A run that has finished (or been abandoned) asks nothing more. Re-opening
  // one because a step was added later would restart a journey somebody has
  // already walked out of.
  if (!run || run.status !== 'ACTIVE') return { asked: 0, waitingOn: null, completed: run?.status === 'COMPLETED' }

  const [steps, completions] = await Promise.all([
    prisma.commsFlowStep.findMany({
      where: run.formId ? { formId: run.formId } : { packageId: run.packageId ?? '' },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.flowStepCompletion.findMany({ where: { runId }, select: { stepId: true } }),
  ])

  const open = availableSteps(
    steps.map(s => ({ ...s, id: s.id, order: s.order, blocking: s.blocking, enabled: s.enabled })),
    completions.map(c => c.stepId),
  )

  // Nobody to ask yet — a journey starts before the person exists (the enquiry
  // is written first, the User arrives at the account step). The steps still
  // sequence; there is simply nothing to notify until then.
  //
  // A TRAINER-actor step is the exception: the trainer exists from the first
  // step, so "accept this time" reaches them whether or not the person walking
  // through the journey has an account yet.
  const client = run.user
  let staffFor: Awaited<ReturnType<typeof staffResolver>> | null = null
  let asked = 0

  for (const step of open) {
    const toTrainer = step.actor === 'TRAINER'
    if (!toTrainer && !client?.id) continue

    // A journey has no session and no class, so "assigned to the session" comes
    // down to whoever owns the business.
    staffFor ??= toTrainer ? await staffResolver(run.trainerId, null) : null
    const recipients = toTrainer ? await staffFor!(null) : [client!]
    if (!recipients.length) continue

    const already = await prisma.commsFlowSend.findMany({
      where: { stepId: step.id, runId, userId: { in: recipients.map(u => u.id) } },
      select: { userId: true },
    })
    const asked0 = new Set(already.map(a => a.userId))

    for (const user of recipients) {
      if (asked0.has(user.id)) continue
      const vars: CommsVars = {
        // A trainer-actor step is ABOUT the person walking the journey, so
        // {{name}} stays theirs however it is addressed.
        name: client?.name ?? 'there',
        dog: '',
        time: '',
        date: '',
        class: '',
        business: run.trainer.businessName,
        location: '',
      }
      const did = await executeFlowStep({
        step,
        user,
        trainer: run.trainer,
        vars,
        // A journey has no session list to send them to. The client's own home
        // is where every one of their screens lives; the trainer's is the
        // client's record, which is where they act on it.
        link: toTrainer ? (run.clientId ? `/clients/${run.clientId}` : '/dashboard') : '/home',
        // Homework belongs to the person on the journey, never to the trainer
        // who was asked to approve something about them.
        clientId: toTrainer ? null : run.clientId,
        date: now,
        companyId: run.trainerId,
      })
      if (!did) continue
      await prisma.commsFlowSend
        .create({ data: { stepId: step.id, runId, userId: user.id } })
        .catch(() => {})
      asked++
    }
  }

  // Park the cursor where the ledger says it should be, and close the run when
  // there is nothing left.
  const { currentStepId, completed } = await advanceFlowRun(runId)
  return { asked, waitingOn: currentStepId, completed }
}

/**
 * One membership step, for every client currently holding that membership.
 *
 * A membership has no sessions, so the anchor is the client's purchase:
 * AFTER_PURCHASE counts forward from when they bought it (welcome, day-7
 * check-in), BEFORE_PERIOD_END counts back from the end of the current period
 * (renewal, expiry). A purchase with no period end simply has nothing for
 * BEFORE_PERIOD_END to fire against, which is the case for every one-off
 * membership — those only ever use AFTER_PURCHASE.
 *
 * Dedup is per (step, purchase, recipient), so a welcome sends once however
 * many times the cron ticks.
 */
async function processMembershipStep(
  step: ExecutableStep & {
    membershipId: string | null
    direction: string
    offsetMinutes: number
    audience: string
    customClientIds: string[]
  },
  membership: { name: string; trainerId: string; trainer: TrainerBrand },
  now: Date,
): Promise<number> {
  const offsetMs = step.offsetMinutes * 60_000
  const tz = membership.trainer.user.timezone ?? 'Pacific/Auckland'

  // The window mirrors the session one: due since the anchor passed, and not so
  // long ago that a flow switched on today back-fills months of history.
  const anchorWhere =
    step.direction === 'AFTER_PURCHASE'
      ? { purchasedAt: { lte: new Date(now.getTime() - offsetMs), gte: new Date(now.getTime() - offsetMs - 30 * DAY_MS) } }
      : { currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + offsetMs) } }

  const purchases = await prisma.membershipPurchase.findMany({
    where: {
      membershipId: step.membershipId!,
      status: 'ACTIVE',
      ...(step.audience === 'CUSTOM' ? { clientId: { in: step.customClientIds } } : {}),
      ...anchorWhere,
    },
    select: {
      id: true,
      purchasedAt: true,
      currentPeriodEnd: true,
      clientId: true,
    },
  })
  if (purchases.length === 0) return 0

  // MembershipPurchase.clientId has no relation on the model, so the client (and
  // their user + dog) is fetched separately.
  const clients = await prisma.clientProfile.findMany({
    where: { id: { in: purchases.map(p => p.clientId) } },
    select: {
      id: true,
      dogId: true,
      dog: { select: { name: true, deceasedAt: true } },
      dogs: { where: { deceasedAt: null }, select: { name: true, deceasedAt: true } },
      user: { select: RECIPIENT_USER_SELECT },
      assignedTrainer: { select: ASSIGNED_MEMBER_SELECT },
    },
  })
  const clientById = new Map(clients.map(c => [c.id, c]))

  const already = await prisma.commsFlowSend.findMany({
    where: { stepId: step.id, purchaseId: { in: purchases.map(p => p.id) } },
    select: { purchaseId: true, userId: true },
  })
  const alreadySent = new Set(already.map(a => `${a.purchaseId}|${a.userId}`))

  // A staff step tells the team about the member ("someone just joined"). A
  // membership has no sessions, so the equivalent of "assigned to the session"
  // is the member's own assigned trainer — the person who looks after them —
  // and the owner when nobody is. The link goes to the trainer-side page.
  // A trainer-actor step resolves the same way; see the session pass.
  const toStaff = step.audience === 'STAFF' || step.actor === 'TRAINER'
  const staffFor = toStaff ? await staffResolver(membership.trainerId, null) : null

  let sent = 0
  for (const purchase of purchases) {
    const client = clientById.get(purchase.clientId)
    if (!client?.user?.id) continue
    // A membership message still goes out (it's about billing, not a dog), but
    // it must never name a dog that has died.
    const dogs = [client.dog?.deceasedAt ? null : client.dog?.name, ...client.dogs.map(d => d.name)]
      .filter((n): n is string => !!n)
      .filter((n, i, arr) => arr.indexOf(n) === i)
    const anchorDate = step.direction === 'AFTER_PURCHASE' ? purchase.purchasedAt : purchase.currentPeriodEnd
    const recipients = staffFor ? await staffFor(client.assignedTrainer) : [client.user]

    for (const user of recipients) {
      if (alreadySent.has(`${purchase.id}|${user.id}`)) continue
      const vars: CommsVars = {
        name: user.name ?? 'there',
        dog: dogs.join(', '),
        time: anchorDate ? fmtTime(anchorDate, tz) : '',
        date: anchorDate ? fmtDate(anchorDate, tz) : '',
        class: membership.name,
        membership: membership.name,
        business: membership.trainer.businessName,
        location: '',
      }
      const did = await executeFlowStep({
        step,
        user,
        trainer: membership.trainer,
        vars,
        link: toStaff ? '/memberships' : '/my-memberships',
        // Staff carry no client, so a TASK step on a membership hands homework
        // to the member and to nobody else.
        clientId: toStaff ? null : client.id,
        dogId: toStaff ? null : client.dogId,
        date: anchorDate ?? now,
        companyId: membership.trainerId,
      })
      if (!did) continue
      await prisma.commsFlowSend
        .create({ data: { stepId: step.id, purchaseId: purchase.id, userId: user.id } })
        .catch(() => {})
      sent++
    }
  }
  return sent
}
