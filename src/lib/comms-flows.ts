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
import { flowAnchorFor } from './flow-steps'
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

type SessionRecipients = { scheduledAt: Date; byUser: Map<string, { user: RecipientUser; dogs: string[] }> }

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
    // A flow step is no longer necessarily a message. MESSAGE keeps the path
    // below, unchanged. The rest are things a PERSON does — fill a form, upload
    // a photo, accept a time — so this cron has nothing to push and nothing to
    // wait for, and its correct behaviour is to leave them alone. They are
    // unreachable in phase 1 (nothing can create one), but the branch exists
    // and is tested so phase 2 is additive rather than a rewrite of this loop.
    //
    // The same goes for a person-anchored MESSAGE: it is unlocked by finishing
    // the previous step, not by a clock, so it is the run that sends it.
    switch (step.kind) {
      case 'MESSAGE':
        // Person-anchored message steps are driven by the FlowRun, not by time.
        if (flowAnchorFor(step) === 'PERSON') {
          skipped++
          continue
        }
        break
      case 'FORM':
      case 'UPLOAD':
      case 'TASK':
      case 'ACCOUNT':
      case 'CHOOSE_OFFERING':
      case 'APPROVAL':
        skipped++
        continue
      default: {
        // A kind added to the enum and not handled here is a compile error,
        // not a message silently going nowhere in production.
        const unhandled: never = step.kind
        void unhandled
        skipped++
        continue
      }
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
    const toStaff = step.audience === 'STAFF'
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
        select: { dropInSessionId: true, dog: { select: { name: true } }, client: { select: { user: { select: RECIPIENT_USER_SELECT } } } },
      })
      for (const s of sessions) {
        // FULL enrolments (dropInSessionId null) attend every session; a drop-in
        // only its one. Dedup by user, collecting their dog name(s).
        const byUser = new Map<string, { user: RecipientUser; dogs: string[] }>()
        const attending: string[] = []
        for (const e of enrollments) {
          if (e.dropInSessionId && e.dropInSessionId !== s.id) continue
          if (e.dog?.name && !attending.includes(e.dog.name)) attending.push(e.dog.name)
          const u = e.client?.user
          if (!u?.id) continue
          const entry = byUser.get(u.id) ?? { user: u, dogs: [] }
          if (e.dog?.name && !entry.dogs.includes(e.dog.name)) entry.dogs.push(e.dog.name)
          byUser.set(u.id, entry)
        }
        if (staffFor) {
          // Staff hear about the session even when nobody has booked yet.
          const staff = await staffFor(s.assignedTrainer)
          if (staff.length) {
            perSession.set(s.id, {
              scheduledAt: s.scheduledAt,
              byUser: new Map(staff.map(u => [u.id, { user: u, dogs: attending }])),
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
          id: true, scheduledAt: true, dog: { select: { name: true } },
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
          if (staff.length) perSession.set(s.id, { scheduledAt: s.scheduledAt, byUser: new Map(staff.map(u => [u.id, { user: u, dogs }])) })
          continue
        }
        const u = s.client?.user
        if (!u?.id) continue
        perSession.set(s.id, { scheduledAt: s.scheduledAt, byUser: new Map([[u.id, { user: u, dogs }]]) })
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

      for (const [userId, { user, dogs }] of byUser) {
        if (alreadySent.has(userId)) continue
        const vars: CommsVars = { ...vars0, name: user.name ?? 'there', dog: dogs.join(', ') }
        const { title, body, emailBody } = renderCommsMessage(step, vars)
        await deliver({ channels: step.channels, important: step.important, user, trainer, title, body, emailBody, link })
        // Record the send. Unique (stepId, sessionId, userId) guards a concurrent
        // tick from double-sending — swallow the conflict if it races.
        await prisma.commsFlowSend.create({ data: { stepId: step.id, sessionId, userId } }).catch(() => {})
        sent++
      }
    }
  }

  return { steps: steps.length, sent, skipped }
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
  step: {
    id: string
    membershipId: string | null
    direction: string
    offsetMinutes: number
    channels: NotificationChannel[]
    audience: string
    customClientIds: string[]
    important: boolean
    // Nullable since flows widened past messages — see renderCommsMessage.
    title: string | null
    body: string | null
    emailBody: string | null
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
  const toStaff = step.audience === 'STAFF'
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
      const { title, body, emailBody } = renderCommsMessage(step, vars)
      await deliver({
        channels: step.channels,
        important: step.important,
        user,
        trainer: membership.trainer,
        title,
        body,
        emailBody,
        link: toStaff ? '/memberships' : '/my-memberships',
      })
      await prisma.commsFlowSend
        .create({ data: { stepId: step.id, purchaseId: purchase.id, userId: user.id } })
        .catch(() => {})
      sent++
    }
  }
  return sent
}
