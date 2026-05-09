import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'
import { renderWeeklySummaryEmail, type SessionRow, type TaskRow } from '@/lib/weekly-summary-email'

// Sunday-evening wrap-up. Cron should hit this hourly (matches the
// daily-summary cadence); the route filters to trainers whose local
// time is the configured Sunday hour (default 19:00 = 7pm).
//
// Sends both push (existing behaviour, body uses substitutable
// {{placeholders}}) AND email (HTML with two tables: what you did,
// what's coming up). Each channel is gated by its own
// NotificationPreference row + the user-level notifyPush/notifyEmail
// flag, so a trainer can have one, both, or neither.
//
// We always pull a fresh week window in the trainer's local timezone
// — the "week" runs Mon→Sun for everyone, so the wrap-up at Sunday
// 7pm covers Mon 00:00 → Sun 23:59.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const meta = NOTIFICATION_TYPES.WEEKLY_SUMMARY
  const defaultHour = meta.defaults.dailyAtHour!

  // Pull every trainer; filter per-channel below. We used to OR in the
  // where clause but Prisma's select-inference dropped the explicit
  // shape when an OR was nested under a model relation filter — easier
  // to do the channel cuts in code where the trainer count is small.
  const candidates = await prisma.user.findMany({
    where: { role: 'TRAINER', trainerProfile: { isNot: null } },
    select: {
      id: true,
      name: true,
      email: true,
      timezone: true,
      notifyPush: true,
      notifyEmail: true,
      trainerProfile: { select: { id: true, businessName: true } },
      deviceTokens: { where: { platform: 'IOS' }, select: { token: true } },
      notificationPreferences: { where: { type: 'WEEKLY_SUMMARY' } },
    },
  })

  // Filter in code: timezone-aware "is it Sunday at the trainer's
  // configured hour right now?" can't be done in SQL. Each channel
  // can have its own dailyAtHour; if either is due, build the summary.
  const due: typeof candidates = []
  for (const u of candidates) {
    const pushPref = u.notificationPreferences.find(p => p.channel === 'PUSH')
    const emailPref = u.notificationPreferences.find(p => p.channel === 'EMAIL')
    const pushHour = pushPref?.dailyAtHour ?? defaultHour
    const emailHour = emailPref?.dailyAtHour ?? defaultHour
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, weekday: 'short', timeZone: u.timezone,
    }).formatToParts(new Date())
    const weekday = parts.find(p => p.type === 'weekday')?.value
    const localHour = Number(parts.find(p => p.type === 'hour')?.value)
    if (weekday !== 'Sun') continue
    const pushDue = u.notifyPush && (!pushPref || pushPref.enabled) && u.deviceTokens.length > 0 && localHour === pushHour
    const emailDue = u.notifyEmail && (!emailPref || emailPref.enabled) && !!u.email && localHour === emailHour
    if (pushDue || emailDue) due.push(u)
  }

  let pushed = 0
  let emailed = 0
  const tokensToDelete: string[] = []

  for (const u of due) {
    if (!u.trainerProfile) continue
    const trainerId = u.trainerProfile.id

    // Build the Mon→Sun window in the trainer's tz. todayInTz returns
    // a YYYY-MM-DD string; on Sunday at 7pm "today" IS the Sunday, so
    // weekStart = today - 6 days, weekEnd = today.
    const today = todayInTz(u.timezone)
    const todayDate = new Date(today + 'T00:00:00')
    const weekStartDate = new Date(todayDate); weekStartDate.setDate(todayDate.getDate() - 6)
    const nextStartDate = new Date(todayDate); nextStartDate.setDate(todayDate.getDate() + 1)
    const nextEndDate = new Date(todayDate);   nextEndDate.setDate(todayDate.getDate() + 7)

    const fmtYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const weekStart = startOfDayInTz(fmtYmd(weekStartDate), u.timezone)
    const weekEnd   = endOfDayInTz(today, u.timezone)
    const nextStart = startOfDayInTz(fmtYmd(nextStartDate), u.timezone)
    const nextEnd   = endOfDayInTz(fmtYmd(nextEndDate), u.timezone)

    const sessionInclude = {
      dog: { select: { name: true } },
      client: { select: { user: { select: { name: true } } } },
      clientPackage: { select: { package: { select: { name: true, priceCents: true, sessionCount: true } } } },
      formResponses: { select: { id: true }, take: 1 },
    } as const

    const [completedSessions, upcomingSessions, upcomingTasksRows] = await Promise.all([
      prisma.trainingSession.findMany({
        where: { trainerId, scheduledAt: { gte: weekStart, lte: weekEnd }, status: 'COMPLETED' },
        orderBy: { scheduledAt: 'asc' },
        include: sessionInclude,
      }),
      prisma.trainingSession.findMany({
        where: { trainerId, scheduledAt: { gte: nextStart, lte: nextEnd } },
        orderBy: { scheduledAt: 'asc' },
        include: sessionInclude,
      }),
      prisma.trainingTask.findMany({
        where: { client: { trainerId }, date: { gte: nextStart, lte: nextEnd } },
        orderBy: { date: 'asc' },
        include: {
          client: { select: { user: { select: { name: true } } } },
          dog: { select: { name: true } },
        },
        take: 50,
      }),
    ])

    const toRow = (s: typeof completedSessions[number]): SessionRow => ({
      scheduledAt: s.scheduledAt,
      title: s.title,
      durationMins: s.durationMins,
      status: s.status as SessionRow['status'],
      invoicedAt: s.invoicedAt,
      hasNotes: s.formResponses.length > 0,
      clientName: s.client?.user.name ?? null,
      dogName: s.dog?.name ?? null,
      packageName: s.clientPackage?.package?.name ?? null,
    })

    const sessionsCompleted = completedSessions.map(toRow)
    const nextWeekSessions = upcomingSessions.map(toRow)
    const nextWeekTasks: TaskRow[] = upcomingTasksRows.map(t => ({
      date: t.date,
      title: t.title,
      clientName: t.client?.user.name ?? null,
      dogName: t.dog?.name ?? null,
    }))

    // Prorate revenue from package price ÷ session count. Sessions
    // attached to an unpriced (or count-less) package contribute zero.
    const revenueCents = completedSessions.reduce((sum, s) => {
      const pkg = s.clientPackage?.package
      if (!pkg?.priceCents || !pkg.sessionCount || pkg.sessionCount <= 0) return sum
      return sum + Math.round(pkg.priceCents / pkg.sessionCount)
    }, 0)

    // ─── Push ────────────────────────────────────────────────────────
    const pushPref = u.notificationPreferences.find(p => p.channel === 'PUSH')
    const pushHour = pushPref?.dailyAtHour ?? defaultHour
    const localHour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: u.timezone,
    }).format(new Date()))
    const pushDue = u.notifyPush && (!pushPref || pushPref.enabled) && u.deviceTokens.length > 0 && localHour === pushHour

    if (pushDue) {
      const title = pushPref?.customTitle ?? meta.defaults.title
      const body = pushPref?.customBody ?? meta.defaults.body
      const subs = {
        sessionsCompleted: String(sessionsCompleted.length),
        revenue: revenueCents > 0 ? formatCents(revenueCents) : '—',
        nextWeekSessions: String(nextWeekSessions.length),
        nextWeekTasks: String(nextWeekTasks.length),
      }
      const results = await sendApns(
        u.deviceTokens.map(d => d.token),
        {
          alert: { title: renderTemplate(title, subs), body: renderTemplate(body, subs) },
          customData: { type: 'weekly-summary' },
        },
      )
      for (const r of results) {
        if (r.ok) pushed++
        else if (r.reason && INVALID_TOKEN_REASONS.has(r.reason)) tokensToDelete.push(r.token)
      }
    }

    // ─── Email ───────────────────────────────────────────────────────
    const emailPref = u.notificationPreferences.find(p => p.channel === 'EMAIL')
    const emailHour = emailPref?.dailyAtHour ?? defaultHour
    const emailDue = u.notifyEmail && (!emailPref || emailPref.enabled) && !!u.email && localHour === emailHour

    if (emailDue && u.email) {
      const trainerFirstName = (u.name?.split(' ')[0] ?? 'there').trim() || 'there'
      const rendered = renderWeeklySummaryEmail({
        weekStart, weekEnd,
        nextWeekStart: nextStart, nextWeekEnd: nextEnd,
        trainerFirstName,
        businessName: u.trainerProfile.businessName,
        sessionsCompleted, nextWeekSessions, nextWeekTasks,
        revenueCents,
        tz: u.timezone,
      })
      try {
        await sendEmail({
          to: u.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        })
        emailed++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[weekly-summary email]', u.email, msg)
      }
    }
  }

  if (tokensToDelete.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: tokensToDelete } } })
  }

  return NextResponse.json({
    candidatesScanned: candidates.length,
    due: due.length,
    pushesSent: pushed,
    emailsSent: emailed,
    tokensInvalidated: tokensToDelete.length,
  })
}

function formatCents(cents: number): string {
  const dollars = Math.round(cents / 100)
  return '$' + dollars.toLocaleString('en-NZ')
}
