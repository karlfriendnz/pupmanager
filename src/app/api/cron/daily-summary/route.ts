import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'
import { sendTrainerEmail } from '@/lib/trainer-notify'

const APP_URL = 'https://app.pupmanager.com'

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
      trainerProfile: { isNot: null },
    },
    select: {
      id: true,
      timezone: true,
      notifyPush: true,
      trainerProfile: { select: { id: true } },
      deviceTokens: { select: { token: true } },
      notificationPreferences: {
        where: { type: 'DAILY_SUMMARY' },
      },
    },
  })

  const due: typeof candidates = []
  for (const u of candidates) {
    const pushPref = u.notificationPreferences.find(p => p.channel === 'PUSH')
    const emailPref = u.notificationPreferences.find(p => p.channel === 'EMAIL')
    const wantsPush = u.notifyPush && (pushPref?.enabled ?? true) && u.deviceTokens.length > 0
    const wantsEmail = emailPref?.enabled ?? (meta.defaultChannels ?? meta.channels).includes('EMAIL')
    if (!wantsPush && !wantsEmail) continue
    const hourPref = pushPref?.dailyAtHour ?? emailPref?.dailyAtHour ?? defaultHour
    const localHour = Number(new Date().toLocaleString('en-US', {
      hour: 'numeric', hour12: false, timeZone: u.timezone,
    }))
    if (localHour === hourPref) due.push(u)
  }

  let pushed = 0

  for (const u of due) {
    if (!u.trainerProfile) continue
    const today = todayInTz(u.timezone)
    const start = startOfDayInTz(today, u.timezone)
    const end = endOfDayInTz(today, u.timezone)

    // Mirror the schedule page's filter: ignore orphaned sessions (no
    // clientId) so we don't tell the trainer they have N sessions
    // today when those Ns aren't on their calendar. (SessionStatus
    // doesn't include CANCELLED in this codebase — orphans are the
    // primary "lingering on the DB but invisible on /schedule" cause.)
    const dailyWhere = {
      trainerId: u.trainerProfile.id,
      scheduledAt: { gte: start, lte: end },
      clientId: { not: null },
    }
    const [sessionCount, clientCount, firstSession] = await Promise.all([
      prisma.trainingSession.count({ where: dailyWhere }),
      prisma.clientProfile.count({ where: { trainerId: u.trainerProfile.id } }),
      prisma.trainingSession.findFirst({
        where: dailyWhere,
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
    ])

    const pref = u.notificationPreferences.find(p => p.channel === 'PUSH')

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

    if (u.notifyPush && (pref?.enabled ?? true) && u.deviceTokens.length > 0) {
      const { sent } = await sendPush(u.id, {
        alert: { title: renderTemplate(title, subs), body: renderTemplate(body, subs) },
        customData: { type: dayOff ? 'daily-summary-day-off' : 'daily-summary' },
      })
      pushed += sent
    }

    // Email channel — gated by its own per-type toggle inside the helper.
    await sendTrainerEmail(u.id, 'DAILY_SUMMARY', subs, `${APP_URL}/dashboard`)
  }


  return NextResponse.json({
    candidatesScanned: candidates.length,
    due: due.length,
    pushesSent: pushed,
  })
}
