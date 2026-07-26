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
import type { NotificationChannel } from '@/generated/prisma'

// Placeholders a trainer can drop into a step's title/body.
export const COMMS_PLACEHOLDERS = [
  '{{name}}', '{{dog}}', '{{time}}', '{{date}}', '{{class}}', '{{business}}', '{{location}}',
] as const

// A membership has no session, so time/date/location have nothing to say.
export const MEMBERSHIP_PLACEHOLDERS = [
  '{{name}}', '{{dog}}', '{{membership}}', '{{business}}', '{{date}}',
] as const

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
    .replace(/\{\{\s*membership\s*\}\}/g, vars.membership ?? '')
}

/** Render a step's title + body (+ optional rich email body) with the
 *  session/recipient variables filled in. */
export function renderCommsMessage(
  step: { title: string; body: string; emailBody?: string | null },
  vars: CommsVars,
): { title: string; body: string; emailBody: string | null } {
  return {
    title: fill(step.title, vars),
    body: fill(step.body, vars),
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
    title: 'Welcome to {{membership}}, {{name}} 🎉',
    body: "You're all set. Everything included is ready to book in the app — see you soon!",
  },
  {
    direction: 'AFTER_PURCHASE' as const,
    offsetMinutes: 7 * 24 * 60,
    channels: ['PUSH'] as NotificationChannel[],
    important: false,
    title: 'How’s it going, {{name}}?',
    body: "Hope you and {{dog}} are enjoying {{membership}}. Anything you need, just message us.",
  },
]

interface RecipientUser {
  id: string
  name: string | null
  email: string
  notifyPush: boolean
  productEmailOptOut: boolean
}

interface TrainerBrand {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
  // timezone comes back from TRAINER_BRAND_SELECT and is what dates are
  // formatted in; optional because the email renderer doesn't need it.
  user: { name: string | null; email: string; timezone?: string | null }
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

/**
 * Who a STAFF-audience step reaches: the members assigned to run this class if
 * it has any (no point telling the whole company about one trainer's Tuesday
 * class), otherwise every accepted member of the business. Package and
 * membership steps have no per-offering assignment, so they always take the
 * whole team.
 */
async function staffRecipients(companyId: string, classRunId: string | null): Promise<RecipientUser[]> {
  const dedupe = (users: (RecipientUser | null | undefined)[]) => {
    const byId = new Map<string, RecipientUser>()
    for (const u of users) if (u?.id) byId.set(u.id, u)
    return [...byId.values()]
  }

  if (classRunId) {
    const assigned = await prisma.classRunTrainer.findMany({
      where: { classRunId, membership: { acceptedAt: { not: null } } },
      select: { membership: { select: { user: { select: RECIPIENT_USER_SELECT } } } },
    })
    const users = dedupe(assigned.map(a => a.membership?.user))
    if (users.length) return users
  }

  const members = await prisma.trainerMembership.findMany({
    where: { companyId, acceptedAt: { not: null } },
    select: { user: { select: RECIPIENT_USER_SELECT } },
  })
  return dedupe(members.map(m => m.user))
}

export async function processCommsFlows(now: Date = new Date()): Promise<{ steps: number; sent: number }> {
  const steps = await prisma.commsFlowStep.findMany({
    where: { enabled: true, channels: { isEmpty: false } },
    include: {
      classRun: { select: { name: true, location: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
      package: { select: { name: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
      membership: { select: { name: true, trainerId: true, trainer: { select: TRAINER_BRAND_SELECT } } },
    },
  })

  let sent = 0
  for (const step of steps) {
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

    // A staff step is about the session, not about one client's booking: every
    // member on it hears the same thing, with {{dog}} standing in for the dogs
    // booked that day.
    const toStaff = step.audience === 'STAFF'
    const staff = toStaff ? await staffRecipients(owner.trainerId, step.classRunId) : []
    if (toStaff && staff.length === 0) continue

    if (step.classRunId) {
      const sessions = await prisma.trainingSession.findMany({
        where: { classRunId: step.classRunId, scheduledAt: scheduledWhere },
        select: { id: true, scheduledAt: true },
      })
      if (sessions.length === 0) continue
      // Everyone on the run in an allowed status (CUSTOM narrows to picked clients).
      const statuses = step.audience === 'ENROLLED_AND_WAITLIST' ? ['ENROLLED', 'WAITLISTED'] : ['ENROLLED']
      const enrollments = await prisma.classEnrollment.findMany({
        where: {
          classRunId: step.classRunId,
          status: { in: statuses as ('ENROLLED' | 'WAITLISTED')[] },
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
        if (toStaff) {
          // Staff hear about the session even when nobody has booked yet.
          perSession.set(s.id, {
            scheduledAt: s.scheduledAt,
            byUser: new Map(staff.map(u => [u.id, { user: u, dogs: attending }])),
          })
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
          ...(step.audience === 'CUSTOM' ? { clientId: { in: step.customClientIds } } : {}),
        },
        select: { id: true, scheduledAt: true, dog: { select: { name: true } }, client: { select: { user: { select: RECIPIENT_USER_SELECT } } } },
      })
      for (const s of sessions) {
        const dogs = s.dog?.name ? [s.dog.name] : []
        if (toStaff) {
          perSession.set(s.id, { scheduledAt: s.scheduledAt, byUser: new Map(staff.map(u => [u.id, { user: u, dogs }])) })
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

  return { steps: steps.length, sent }
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
    title: string
    body: string
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
      dog: { select: { name: true } },
      dogs: { select: { name: true } },
      user: { select: RECIPIENT_USER_SELECT },
    },
  })
  const clientById = new Map(clients.map(c => [c.id, c]))

  const already = await prisma.commsFlowSend.findMany({
    where: { stepId: step.id, purchaseId: { in: purchases.map(p => p.id) } },
    select: { purchaseId: true, userId: true },
  })
  const alreadySent = new Set(already.map(a => `${a.purchaseId}|${a.userId}`))

  // A staff step tells the team about the member ("someone just joined"), so the
  // recipients are the business's members and the link is the trainer-side page.
  const toStaff = step.audience === 'STAFF'
  const staff = toStaff ? await staffRecipients(membership.trainerId, null) : []
  if (toStaff && staff.length === 0) return 0

  let sent = 0
  for (const purchase of purchases) {
    const client = clientById.get(purchase.clientId)
    if (!client?.user?.id) continue
    const dogs = [client.dog?.name, ...client.dogs.map(d => d.name)]
      .filter((n): n is string => !!n)
      .filter((n, i, arr) => arr.indexOf(n) === i)
    const anchorDate = step.direction === 'AFTER_PURCHASE' ? purchase.purchasedAt : purchase.currentPeriodEnd
    const recipients = toStaff ? staff : [client.user]

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
