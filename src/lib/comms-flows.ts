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
import { renderClientNotificationEmail } from './client-notification-email'
import type { NotificationChannel } from '@/generated/prisma'

// Placeholders a trainer can drop into a step's title/body.
export const COMMS_PLACEHOLDERS = [
  '{{name}}', '{{dog}}', '{{time}}', '{{date}}', '{{class}}', '{{business}}', '{{location}}',
] as const

export interface CommsVars {
  name: string
  dog: string
  time: string
  date: string
  class: string
  business: string
  location: string
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
}

/** Render a step's title + body with the session/recipient variables filled in. */
export function renderCommsMessage(
  step: { title: string; body: string },
  vars: CommsVars,
): { title: string; body: string } {
  return { title: fill(step.title, vars), body: fill(step.body, vars) }
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
  user: { name: string | null; email: string }
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
  link: string
}): Promise<void> {
  const { channels, important, user, trainer, title, body, link } = args

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
      body,
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
export async function processCommsFlows(now: Date = new Date()): Promise<{ steps: number; sent: number }> {
  const steps = await prisma.commsFlowStep.findMany({
    where: { enabled: true, channels: { isEmpty: false } },
    include: {
      classRun: {
        select: {
          name: true,
          location: true,
          trainer: {
            select: {
              businessName: true,
              logoUrl: true,
              emailAccentColor: true,
              user: { select: { name: true, email: true, timezone: true } },
            },
          },
        },
      },
    },
  })

  let sent = 0
  for (const step of steps) {
    const offsetMs = step.offsetMinutes * 60_000
    const tz = step.classRun.trainer.user.timezone ?? 'Pacific/Auckland'
    const trainer: TrainerBrand = step.classRun.trainer

    const scheduledWhere =
      step.direction === 'BEFORE_SESSION'
        ? { gte: now, lte: new Date(now.getTime() + offsetMs) }
        : { lte: new Date(now.getTime() - offsetMs), gte: new Date(now.getTime() - offsetMs - 30 * DAY_MS) }

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
      select: {
        dropInSessionId: true,
        dog: { select: { name: true } },
        client: {
          select: {
            user: {
              select: { id: true, name: true, email: true, notifyPush: true, productEmailOptOut: true },
            },
          },
        },
      },
    })

    const link = '/my-sessions'

    for (const s of sessions) {
      // Recipients for THIS session: FULL enrolments (dropInSessionId null) plus
      // any drop-in enrolment whose one session is this one. Dedup by user, and
      // collect their dog name(s) for the {{dog}} placeholder.
      const byUser = new Map<string, { user: RecipientUser; dogs: string[] }>()
      for (const e of enrollments) {
        if (e.dropInSessionId && e.dropInSessionId !== s.id) continue
        const u = e.client?.user
        if (!u?.id) continue
        const entry = byUser.get(u.id) ?? { user: u, dogs: [] }
        if (e.dog?.name && !entry.dogs.includes(e.dog.name)) entry.dogs.push(e.dog.name)
        byUser.set(u.id, entry)
      }
      if (byUser.size === 0) continue

      const already = await prisma.commsFlowSend.findMany({
        where: { stepId: step.id, sessionId: s.id },
        select: { userId: true },
      })
      const alreadySent = new Set(already.map(a => a.userId))

      const vars0 = {
        time: fmtTime(s.scheduledAt, tz),
        date: fmtDate(s.scheduledAt, tz),
        class: step.classRun.name,
        business: trainer.businessName,
        location: step.classRun.location ?? '',
      }

      for (const [userId, { user, dogs }] of byUser) {
        if (alreadySent.has(userId)) continue
        const vars: CommsVars = { ...vars0, name: user.name ?? 'there', dog: dogs.join(', ') }
        const { title, body } = renderCommsMessage(step, vars)
        await deliver({ channels: step.channels, important: step.important, user, trainer, title, body, link })
        // Record the send. Unique (stepId, sessionId, userId) guards a concurrent
        // tick from double-sending — swallow the conflict if it races.
        await prisma.commsFlowSend
          .create({ data: { stepId: step.id, sessionId: s.id, userId } })
          .catch(() => {})
        sent++
      }
    }
  }

  return { steps: steps.length, sent }
}
