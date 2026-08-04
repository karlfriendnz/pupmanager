import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; buddyId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId, buddyId } = await params

  // Walk through the session to confirm the caller can access it
  const buddy = await prisma.sessionBuddy.findFirst({
    where: { id: buddyId, sessionId, session: { trainerId, ...accessibleSessionWhere(ctx) } },
    select: {
      id: true, clientId: true, dogId: true,
      session: { select: { walkSeriesId: true, scheduledAt: true } },
    },
  })
  if (!buddy) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Remove across the run, the way ADDING already reaches across it.
  //
  // POST takes scope this | following | series and adds the dog to every
  // matching walk — and the picker defaults to `series`, so the ordinary tap
  // books them onto the whole run. DELETE ignored scope entirely and removed
  // ONE row, so a trainer who took a dog off was left with it still booked onto
  // every later walk: wrong headcount, and a dog turning up they thought they'd
  // removed (audit T-14).
  //
  // Default stays `this`, so a caller that says nothing behaves exactly as
  // before. The sibling session DELETE already reads ?scope= the same way.
  const scope = new URL(req.url).searchParams.get('scope')
  const seriesId = buddy.session?.walkSeriesId

  if (seriesId && (scope === 'series' || scope === 'following')) {
    const { count } = await prisma.sessionBuddy.deleteMany({
      where: {
        clientId: buddy.clientId,
        dogId: buddy.dogId,
        session: {
          trainerId,
          walkSeriesId: seriesId,
          ...(scope === 'following' ? { scheduledAt: { gte: buddy.session!.scheduledAt } } : {}),
        },
      },
    })
    return NextResponse.json({ ok: true, removed: count })
  }

  await prisma.sessionBuddy.delete({ where: { id: buddyId } })
  return NextResponse.json({ ok: true, removed: 1 })
}
