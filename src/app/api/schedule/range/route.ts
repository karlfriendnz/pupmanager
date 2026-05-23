import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, scopeForMember } from '@/lib/membership'

// Returns the trainer's sessions whose start time falls in [from, to]. Used by
// the schedule modals to show conflict warnings when the trainer picks a time
// that already has a session. Scoped to the member's own sessions when they
// lack schedule.viewAll, so conflict checks reflect their own calendar.
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId
  const memberScope = scopeForMember(ctx, 'schedule.viewAll')

  const url = new URL(req.url)
  const fromStr = url.searchParams.get('from')
  const toStr = url.searchParams.get('to')
  if (!fromStr || !toStr) return NextResponse.json({ error: 'Missing range' }, { status: 400 })
  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
  }

  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { gte: from, lte: to },
      ...memberScope,
    },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMins: true,
      status: true,
    },
    orderBy: { scheduledAt: 'asc' },
  })

  return NextResponse.json(sessions.map(s => ({
    ...s,
    scheduledAt: s.scheduledAt.toISOString(),
  })))
}
