import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { getStreak, todayStatus, syncBadges } from '@/lib/trainer-streak'
import { sendTrainerEmail } from '@/lib/trainer-notify'

const APP_URL = 'https://app.pupmanager.com'

// Invoked HOURLY by a Supabase pg_cron job (NOT a Vercel cron). For each
// push-enabled trainer whose local time is 8pm: if today is a training
// day AND today's notes aren't done, nudge them to finish (and keep
// their training-day streak). Also syncs newly earned badges. No nag on
// non-training days or once the notes are done. (There's no reliable
// per-user "logged in today" signal in the schema — notesDone is the
// authoritative "they're on top of it" gate, which is what matters.)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REMIND_HOUR = 20 // 8pm, trainer-local

function localParts(tz: string) {
  const now = new Date()
  return {
    hour: Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz })),
    date: now.toLocaleDateString('en-CA', { timeZone: tz }),
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const meta = NOTIFICATION_TYPES.STREAK_UPDATE

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
      notificationPreferences: { where: { type: 'STREAK_UPDATE' } },
    },
  })

  // Only trainers whose local time is the reminder hour right now and who want
  // it on at least one channel.
  const due = candidates.filter(u => {
    const pushPref = u.notificationPreferences.find(p => p.channel === 'PUSH')
    const emailPref = u.notificationPreferences.find(p => p.channel === 'EMAIL')
    const wantsPush = u.notifyPush && (pushPref?.enabled ?? true) && u.deviceTokens.length > 0
    const wantsEmail = emailPref?.enabled ?? (meta.defaultChannels ?? meta.channels).includes('EMAIL')
    if (!wantsPush && !wantsEmail) return false
    return localParts(u.timezone).hour === REMIND_HOUR
  })

  let pushed = 0
  let badgesAwarded = 0

  for (const u of due) {
    if (!u.trainerProfile) continue
    const trainerId = u.trainerProfile.id
    const tz = u.timezone

    const { current, longest } = await getStreak(trainerId, tz)

    // Badge sync (cheap; surfaces on /awards regardless of the push).
    const [clients, sessionsDelivered] = await Promise.all([
      prisma.clientProfile.count({ where: { trainerId } }),
      prisma.trainingSession.count({
        where: { trainerId, status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } },
      }),
    ])
    badgesAwarded += (
      await syncBadges(trainerId, { clients, sessionsDelivered, currentStreak: current, longestStreak: longest })
    ).length

    const { isTrainingDay, notesDone } = await todayStatus(trainerId, tz)
    if (!isTrainingDay) continue // no training today — nothing to nag about
    if (notesDone) continue // already on top of it

    const streakLine =
      current > 0
        ? `Finish today's notes to keep your ${current}-day streak alive.`
        : `Finish today's session notes before the day's out.`
    const subs = { message: streakLine, weeks: String(current) }

    const pushPref = u.notificationPreferences.find(p => p.channel === 'PUSH')
    if (u.notifyPush && (pushPref?.enabled ?? true) && u.deviceTokens.length > 0) {
      const { sent } = await sendPush(u.id, {
        alert: {
          title: renderTemplate(meta.defaults.title, subs),
          body: renderTemplate(meta.defaults.body, subs),
        },
        customData: { type: 'streak-notes-reminder' },
      })
      pushed += sent
    }

    // Email channel — gated by its own per-type toggle inside the helper.
    await sendTrainerEmail(u.id, 'STREAK_UPDATE', subs, `${APP_URL}/dashboard`)
  }


  return NextResponse.json({
    candidatesScanned: candidates.length,
    due: due.length,
    pushesSent: pushed,
    badgesAwarded,
  })
}
