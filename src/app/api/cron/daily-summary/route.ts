import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'

// Runs hourly. For each trainer whose `dailyAtHour` matches the current hour
// in their timezone (push channel enabled), composes and sends a one-line
// summary of today's bookings + active client count.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const meta = NOTIFICATION_TYPES.DAILY_SUMMARY
  const defaultHour = meta.defaults.dailyAtHour!

  // Pull every trainer who has a device token + push enabled. Filter in code
  // because the "current hour in this user's tz" comparison can't be done in SQL
  // without a tz-aware function library, and the trainer count is small.
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
        where: { type: 'DAILY_SUMMARY', channel: 'PUSH' },
      },
    },
  })

  const due: typeof candidates = []
  for (const u of candidates) {
    const pref = u.notificationPreferences[0]
    if (pref && !pref.enabled) continue
    const hourPref = pref?.dailyAtHour ?? defaultHour
    const localHour = Number(new Date().toLocaleString('en-US', {
      hour: 'numeric', hour12: false, timeZone: u.timezone,
    }))
    if (localHour === hourPref) due.push(u)
  }

  let pushed = 0
  const tokensToDelete: string[] = []

  for (const u of due) {
    if (!u.trainerProfile) continue
    const today = todayInTz(u.timezone)
    const start = startOfDayInTz(today, u.timezone)
    const end = endOfDayInTz(today, u.timezone)

    const [sessionCount, clientCount, firstSession] = await Promise.all([
      prisma.trainingSession.count({
        where: { trainerId: u.trainerProfile.id, scheduledAt: { gte: start, lte: end } },
      }),
      prisma.clientProfile.count({ where: { trainerId: u.trainerProfile.id } }),
      prisma.trainingSession.findFirst({
        where: { trainerId: u.trainerProfile.id, scheduledAt: { gte: start, lte: end } },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
    ])

    const pref = u.notificationPreferences[0]

    // Day-off path: when there's nothing booked AND the trainer hasn't
    // opted out, swap the digest for a warm "take the day off" copy.
    // Honours their custom overrides if they've set a non-default
    // title/body — otherwise picks the day-off defaults below.
    const dayOff = sessionCount === 0 && (pref?.dayOffSummary ?? true)

    const title = pref?.customTitle ?? (dayOff ? 'Day off ☕️' : meta.defaults.title)
    const body = pref?.customBody ?? (dayOff
      ? 'No sessions today — kick back, refill the coffee, your dogs (and clients) can wait.'
      : meta.defaults.body)

    const subs = {
      sessionCount: String(sessionCount),
      clientCount: String(clientCount),
      firstSessionTime: firstSession
        ? firstSession.scheduledAt.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: u.timezone })
        : '—',
    }

    const results = await sendApns(
      u.deviceTokens.map(d => d.token),
      {
        alert: { title: renderTemplate(title, subs), body: renderTemplate(body, subs) },
        customData: { type: dayOff ? 'daily-summary-day-off' : 'daily-summary' },
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
