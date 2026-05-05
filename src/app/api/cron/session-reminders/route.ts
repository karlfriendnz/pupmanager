import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'

// Vercel Cron runs this every 5 minutes; we look ~20 minutes ahead with a
// generous window so a missed cron run still catches sessions on the next tick,
// and `reminderPushSentAt` guarantees no duplicates.
const LOOKAHEAD_MIN = 20
const WINDOW_MIN = 10

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() + (LOOKAHEAD_MIN - WINDOW_MIN / 2) * 60_000)
  const windowEnd = new Date(now.getTime() + (LOOKAHEAD_MIN + WINDOW_MIN / 2) * 60_000)

  const sessions = await prisma.trainingSession.findMany({
    where: {
      scheduledAt: { gte: windowStart, lte: windowEnd },
      status: 'UPCOMING',
      reminderPushSentAt: null,
    },
    include: {
      dog: { select: { name: true } },
      client: { select: { user: { select: { name: true } } } },
      trainer: {
        select: {
          user: {
            select: {
              id: true,
              notifyPush: true,
              timezone: true,
              deviceTokens: { where: { platform: 'IOS' } },
            },
          },
        },
      },
    },
  })

  let pushed = 0
  const tokensToDelete: string[] = []

  for (const s of sessions) {
    const trainerUser = s.trainer.user
    if (!trainerUser.notifyPush) {
      // Still mark as sent so we don't re-evaluate every cron tick.
      await prisma.trainingSession.update({
        where: { id: s.id },
        data: { reminderPushSentAt: now },
      })
      continue
    }
    if (trainerUser.deviceTokens.length === 0) continue

    const subjectName = s.dog?.name ?? s.client?.user?.name ?? 'a session'
    const startTime = s.scheduledAt.toLocaleTimeString('en-NZ', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: trainerUser.timezone,
    })

    const results = await sendApns(
      trainerUser.deviceTokens.map(d => d.token),
      {
        alert: {
          title: `Upcoming session — ${subjectName}`,
          body: `${s.title} at ${startTime} (in ~20 min)`,
        },
        customData: { sessionId: s.id, type: 'session-reminder' },
      },
    )

    for (const r of results) {
      if (r.ok) pushed++
      else if (r.reason && INVALID_TOKEN_REASONS.has(r.reason)) tokensToDelete.push(r.token)
    }

    await prisma.trainingSession.update({
      where: { id: s.id },
      data: { reminderPushSentAt: now },
    })
  }

  if (tokensToDelete.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: tokensToDelete } } })
  }

  return NextResponse.json({
    sessionsConsidered: sessions.length,
    pushesSent: pushed,
    tokensInvalidated: tokensToDelete.length,
  })
}
