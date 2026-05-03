import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { evaluateAchievementsFor } from '@/lib/achievements'

// Daily sweep — re-evaluates every active client so we catch awards driven
// by time-based rules (CLIENT_ANNIVERSARY_DAYS) or events the inline hooks
// missed. Authorization via CRON_SECRET to match the existing cron pattern.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const clients = await prisma.clientProfile.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  })

  let total = 0
  for (const c of clients) {
    try {
      const wins = await evaluateAchievementsFor(c.id)
      total += wins.length
    } catch {
      // Skip a single client's failure — keep the sweep going.
    }
  }

  return NextResponse.json({ ok: true, clientsScanned: clients.length, awarded: total })
}
