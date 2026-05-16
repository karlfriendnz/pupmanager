import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import {
  isoWeekKey,
  activeWeekKeys,
  currentStreak,
  longestStreak,
  streakAtRisk,
  syncBadges,
} from '@/lib/trainer-streak'

// Invoked once daily by a Supabase pg_cron job (NOT a Vercel cron — see
// the supabase cron migration). Sends every push-enabled trainer one
// curated line about their weekly engagement streak (or an at-risk
// warning) and syncs newly earned badges. Trainers with no live streak
// get nothing — no daily nagging of lapsed/brand-new accounts.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const meta = NOTIFICATION_TYPES.STREAK_UPDATE

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
      notificationPreferences: { where: { type: 'STREAK_UPDATE', channel: 'PUSH' } },
    },
  })

  // Fired once a day by Supabase, so no per-timezone hour gating — every
  // eligible trainer (push on, pref not disabled) is due this run.
  const due = candidates.filter(u => {
    const pref = u.notificationPreferences[0]
    return !pref || pref.enabled
  })

  const week = isoWeekKey(new Date())
  let pushed = 0
  let badgesAwarded = 0
  const tokensToDelete: string[] = []

  for (const u of due) {
    if (!u.trainerProfile) continue
    const trainerId = u.trainerProfile.id

    const keys = await activeWeekKeys(trainerId)
    const streak = currentStreak(keys, week)

    // Sync badges every day regardless (cheap; dashboard surfaces them).
    const [clients, sessionsDelivered] = await Promise.all([
      prisma.clientProfile.count({ where: { trainerId } }),
      prisma.trainingSession.count({
        where: { trainerId, status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } },
      }),
    ])
    const fresh = await syncBadges(trainerId, {
      clients,
      sessionsDelivered,
      currentStreakWeeks: streak,
      longestStreakWeeks: longestStreak(keys),
    })
    badgesAwarded += fresh.length

    // No live streak → don't send (avoid daily nagging).
    if (streak === 0) continue

    const atRisk = streakAtRisk(keys, week)
    const message = atRisk
      ? `Your ${streak}-week streak needs an action this week — don’t let it slip.`
      : `${streak}-week streak going — you’ve already been active this week. Nice.`

    const subs = { message, weeks: String(streak) }
    const results = await sendApns(
      u.deviceTokens.map(d => d.token),
      {
        alert: {
          title: renderTemplate(meta.defaults.title, subs),
          body: renderTemplate(meta.defaults.body, subs),
        },
        customData: { type: atRisk ? 'streak-at-risk' : 'streak-update' },
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
    badgesAwarded,
    tokensInvalidated: tokensToDelete.length,
  })
}
