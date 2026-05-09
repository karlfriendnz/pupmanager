import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'

// Sunday-evening wrap-up. Cron should hit this hourly (matches the
// daily-summary cadence); the route filters to trainers whose local
// time is the configured Sunday hour (default 19:00 = 7pm).
//
// Body subs:
//   {{sessionsCompleted}} — sessions that fell inside the past week
//   {{revenue}}           — pretty-printed total ($480), prorated from
//                           Package.priceCents / sessionCount (skip
//                           sessions without a priced package)
//   {{nextWeekSessions}}  — booked sessions in the coming week
//   {{nextWeekTasks}}     — diary tasks already on the calendar for
//                           the coming week
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

  const candidates = await prisma.user.findMany({
    where: {
      role: 'TRAINER',
      notifyPush: true,
      trainerProfile: { isNot: null },
      deviceTokens: { some: { platform: 'IOS' } },
    },
    select: {
      id: true,
      timezone: true,
      trainerProfile: { select: { id: true } },
      deviceTokens: { where: { platform: 'IOS' }, select: { token: true } },
      notificationPreferences: {
        where: { type: 'WEEKLY_SUMMARY', channel: 'PUSH' },
      },
    },
  })

  // Filter in code: timezone-aware "is it Sunday at the trainer's
  // configured hour right now?" can't be done in SQL without a
  // tz-aware extension. Trainer count is small.
  const due: typeof candidates = []
  for (const u of candidates) {
    const pref = u.notificationPreferences[0]
    if (pref && !pref.enabled) continue
    const hourPref = pref?.dailyAtHour ?? defaultHour
    // Intl gives us "Sun, 19" reliably for any tz the user might be in.
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false,
      weekday: 'short',
      timeZone: u.timezone,
    }).formatToParts(new Date())
    const weekday = parts.find(p => p.type === 'weekday')?.value
    const localHour = Number(parts.find(p => p.type === 'hour')?.value)
    if (weekday === 'Sun' && localHour === hourPref) due.push(u)
  }

  let pushed = 0
  const tokensToDelete: string[] = []

  for (const u of due) {
    if (!u.trainerProfile) continue
    const trainerId = u.trainerProfile.id

    // Build the Mon→Sun window in the trainer's tz. todayInTz returns
    // a YYYY-MM-DD string; on Sunday at 7pm "today" IS the Sunday, so
    // weekStart = today - 6 days, weekEnd = today.
    const today = todayInTz(u.timezone)
    const todayDate = new Date(today + 'T00:00:00')
    const weekStartDate = new Date(todayDate)
    weekStartDate.setDate(todayDate.getDate() - 6)
    const nextStartDate = new Date(todayDate)
    nextStartDate.setDate(todayDate.getDate() + 1)
    const nextEndDate = new Date(todayDate)
    nextEndDate.setDate(todayDate.getDate() + 7)

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const weekStart = startOfDayInTz(fmt(weekStartDate), u.timezone)
    const weekEnd = endOfDayInTz(today, u.timezone)
    const nextStart = startOfDayInTz(fmt(nextStartDate), u.timezone)
    const nextEnd = endOfDayInTz(fmt(nextEndDate), u.timezone)

    const [completedThisWeek, sessionsThisWeekWithPackage, nextWeekSessionCount, nextWeekTaskCount] = await Promise.all([
      prisma.trainingSession.count({
        where: { trainerId, scheduledAt: { gte: weekStart, lte: weekEnd }, status: 'COMPLETED' },
      }),
      // Pull priced packages so we can prorate revenue. Avoid loading the
      // full session row when we just need the package's price + count.
      prisma.trainingSession.findMany({
        where: { trainerId, scheduledAt: { gte: weekStart, lte: weekEnd }, status: 'COMPLETED' },
        select: {
          clientPackage: { select: { package: { select: { priceCents: true, sessionCount: true } } } },
        },
      }),
      prisma.trainingSession.count({
        where: { trainerId, scheduledAt: { gte: nextStart, lte: nextEnd } },
      }),
      // Tasks the trainer has assigned to clients this trainer manages,
      // dated within the coming week.
      prisma.trainingTask.count({
        where: {
          client: { trainerId },
          date: { gte: nextStart, lte: nextEnd },
        },
      }),
    ])

    const revenueCents = sessionsThisWeekWithPackage.reduce((sum, s) => {
      const pkg = s.clientPackage?.package
      if (!pkg?.priceCents || !pkg.sessionCount || pkg.sessionCount <= 0) return sum
      return sum + Math.round(pkg.priceCents / pkg.sessionCount)
    }, 0)

    const pref = u.notificationPreferences[0]
    const title = pref?.customTitle ?? meta.defaults.title
    const body = pref?.customBody ?? meta.defaults.body

    const subs = {
      sessionsCompleted: String(completedThisWeek),
      revenue: revenueCents > 0 ? formatCents(revenueCents) : '—',
      nextWeekSessions: String(nextWeekSessionCount),
      nextWeekTasks: String(nextWeekTaskCount),
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

  if (tokensToDelete.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: tokensToDelete } } })
  }

  return NextResponse.json({
    candidatesScanned: candidates.length,
    due: due.length,
    pushesSent: pushed,
    tokensInvalidated: tokensToDelete.length,
  })
}

// "$480" / "$1,250". We keep the formatting simple and locale-free
// (en-NZ default) since the symbol is going into a push title where
// fancy locale-specific separators aren't worth the localisation cost.
function formatCents(cents: number): string {
  const dollars = Math.round(cents / 100)
  return '$' + dollars.toLocaleString('en-NZ')
}
