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
      // The assigned member drives the per-person double-booking gate: a drag-drop
      // only flags a clash against sessions run by the SAME person (null = owner).
      assignedMembershipId: true,
      // classRunId lets a drag-drop overlap scan tell two occurrences of the
      // SAME group class apart from a genuine double-booking; the relation names
      // give the confirm modal a human label (client / dog / class / package).
      classRunId: true,
      client: { select: { user: { select: { name: true } } } },
      dog: { select: { name: true } },
      classRun: { select: { name: true } },
      clientPackage: { select: { package: { select: { name: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  return NextResponse.json(sessions.map(s => ({
    id: s.id,
    title: s.title,
    scheduledAt: s.scheduledAt.toISOString(),
    durationMins: s.durationMins,
    status: s.status,
    assignedMembershipId: s.assignedMembershipId,
    classRunId: s.classRunId,
    label: s.client?.user?.name || s.dog?.name || s.classRun?.name || s.clientPackage?.package?.name || null,
  })))
}
