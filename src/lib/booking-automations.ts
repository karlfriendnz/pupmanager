// Booking-page automations: trainer-authored emails that fire off a booking.
// ON_BOOKING sends inline at booking time (runOnBookingAutomations); the
// BEFORE/AFTER_SESSION ones are sent by the booking-automations cron once their
// offset relative to the session is due (processScheduledAutomations).
// Bodies are plain text with {name} {dog} {time} {business} placeholders.
import { prisma } from './prisma'
import { sendEmail } from './email'
import { escapeHtml } from './enquiries'
import type { BookingAutomation } from '@/generated/prisma'

export const AUTOMATION_PLACEHOLDERS = ['{name}', '{dog}', '{time}', '{business}'] as const

interface Vars {
  name: string
  dog: string
  time: string
  business: string
}

function fill(template: string, vars: Vars, escape: boolean): string {
  const v = escape
    ? { name: escapeHtml(vars.name), dog: escapeHtml(vars.dog), time: escapeHtml(vars.time), business: escapeHtml(vars.business) }
    : vars
  return template
    .replace(/\{name\}/g, v.name)
    .replace(/\{dog\}/g, v.dog)
    .replace(/\{time\}/g, v.time)
    .replace(/\{business\}/g, v.business)
}

export function formatBookingTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(date)
}

/** Render a trainer-authored automation into a subject + branded HTML body. */
export function renderAutomationEmail(
  automation: { subject: string; body: string },
  vars: Vars,
): { subject: string; html: string } {
  const subject = fill(automation.subject, vars, false)
  const bodyHtml = fill(automation.body, vars, true).replace(/\n/g, '<br>')
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;color:#0f172a;">
      <div style="color:#475569;font-size:15px;line-height:1.6;">${bodyHtml}</div>
      <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Sent by ${escapeHtml(vars.business)} via PupManager.</p>
    </div>`
  return { subject, html }
}

interface OnBookingArgs {
  bookingPageId: string
  recipientEmail: string
  name: string
  dogName: string | null
  sessionAt: Date
  tz: string
  businessName: string
}

/**
 * Fire every enabled ON_BOOKING automation for a page immediately. Best-effort:
 * a flaky email send never fails the booking it's reacting to.
 */
export async function runOnBookingAutomations(args: OnBookingArgs): Promise<void> {
  try {
    const autos = await prisma.bookingAutomation.findMany({
      where: { bookingPageId: args.bookingPageId, trigger: 'ON_BOOKING', enabled: true },
      orderBy: { order: 'asc' },
    })
    const vars: Vars = {
      name: args.name,
      dog: args.dogName ?? '',
      time: formatBookingTime(args.sessionAt, args.tz),
      business: args.businessName,
    }
    for (const a of autos) {
      const { subject, html } = renderAutomationEmail(a, vars)
      await sendEmail({ to: args.recipientEmail, subject, html }).catch(err =>
        console.error('[booking-automations on-booking] send failed', err),
      )
    }
  } catch (err) {
    console.error('[booking-automations on-booking] failed', err)
  }
}

const DAY_MS = 86_400_000

const SESSION_SELECT = {
  id: true,
  scheduledAt: true,
  dog: { select: { name: true } },
  client: { select: { dog: { select: { name: true } }, user: { select: { name: true, email: true } } } },
} as const

/**
 * Cron worker: send any due BEFORE/AFTER_SESSION automation emails exactly once.
 * BEFORE fires while now is within `offset` of an upcoming session; AFTER fires
 * once now is past session + offset (bounded to the last 30 days so old sessions
 * never reopen). Dedup is the unique (automationId, sessionId) send row.
 */
export async function processScheduledAutomations(now: Date = new Date()): Promise<{ automations: number; sent: number }> {
  const autos = await prisma.bookingAutomation.findMany({
    where: { enabled: true, trigger: { in: ['BEFORE_SESSION', 'AFTER_SESSION'] } },
    include: {
      bookingPage: { select: { trainer: { select: { businessName: true, user: { select: { timezone: true } } } } } },
    },
  })

  let sent = 0
  for (const a of autos) {
    const offsetMs = a.offsetMinutes * 60_000
    const tz = a.bookingPage.trainer.user.timezone
    const businessName = a.bookingPage.trainer.businessName

    const scheduledWhere =
      a.trigger === 'BEFORE_SESSION'
        ? { gte: now, lte: new Date(now.getTime() + offsetMs) }
        : { lte: new Date(now.getTime() - offsetMs), gte: new Date(now.getTime() - offsetMs - 30 * DAY_MS) }

    const sessions = await prisma.trainingSession.findMany({
      where: {
        bookingPageId: a.bookingPageId,
        clientId: { not: null },
        scheduledAt: scheduledWhere,
        automationSends: { none: { automationId: a.id } },
      },
      select: SESSION_SELECT,
    })

    for (const s of sessions) {
      const email = s.client?.user?.email
      if (!email) continue
      const vars: Vars = {
        name: s.client?.user?.name ?? 'there',
        dog: s.dog?.name ?? s.client?.dog?.name ?? '',
        time: formatBookingTime(s.scheduledAt, tz),
        business: businessName,
      }
      const { subject, html } = renderAutomationEmail(a, vars)
      try {
        await sendEmail({ to: email, subject, html })
        // Record the send. Unique (automationId, sessionId) guards against a
        // concurrent tick double-sending — swallow the conflict if it races.
        await prisma.bookingAutomationSend.create({ data: { automationId: a.id, sessionId: s.id } }).catch(() => {})
        sent++
      } catch (err) {
        console.error('[booking-automations scheduled] send failed', err)
      }
    }
  }

  return { automations: autos.length, sent }
}

// Defaults offered in the UI when a trainer adds an automation of each type.
export const AUTOMATION_DEFAULTS: Record<BookingAutomation['trigger'], { offsetMinutes: number; subject: string; body: string }> = {
  ON_BOOKING: {
    offsetMinutes: 0,
    subject: 'Your booking with {business}',
    body: "Hi {name},\n\nThanks for booking! You're set for {time}.\n\nSee you then,\n{business}",
  },
  BEFORE_SESSION: {
    offsetMinutes: 1440,
    subject: 'Reminder: your session with {business}',
    body: "Hi {name},\n\nJust a reminder that your session is coming up at {time}.\n\nSee you soon,\n{business}",
  },
  AFTER_SESSION: {
    offsetMinutes: 120,
    subject: 'Thanks for coming in — {business}',
    body: "Hi {name},\n\nGreat to see you and {dog}! If you'd like to book your next session, just reply to this email.\n\n{business}",
  },
}
