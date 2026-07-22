import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { deleteGoogleEvents } from '@/lib/google-calendar-sync'

export const runtime = 'nodejs'

/**
 * Turn a class back into a plain 1:1 package.
 *
 * A class is a ClassRun off a group Package, so "convert this class" can't just
 * flip the package — the run and its shared session series have to go, or
 * they'd be left pointing at a package that no longer works that way. That
 * makes this destructive, so it's refused the moment anyone is actually booked
 * in: if people are on the roster, the trainer should cancel the class properly
 * (which notifies them) rather than have it dissolve underneath them.
 *
 * With an empty run it's the obvious repair for "I made this a class by
 * mistake": the sessions disappear, the package becomes a 1:1 one, and the
 * trainer lands on it ready to assign to a client.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  const trainerId = session?.user?.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    select: {
      id: true,
      packageId: true,
      // Captured before the cascade so the mirrored events can be pulled off
      // the trainer's Google Calendar afterwards.
      sessions: { select: { googleCalendarEventId: true } },
      enrollments: { where: { status: { not: 'WITHDRAWN' } }, select: { id: true } },
    },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (run.enrollments.length > 0) {
    const n = run.enrollments.length
    return NextResponse.json(
      { error: `${n} ${n === 1 ? 'person is' : 'people are'} booked into this class. Remove them (or cancel the class) before converting it.` },
      { status: 409 },
    )
  }

  const deletedEventIds = run.sessions
    .map(s => s.googleCalendarEventId)
    .filter((id): id is string => !!id)

  try {
    await prisma.$transaction([
      prisma.trainingSession.deleteMany({ where: { classRunId: runId, trainerId } }),
      prisma.classRun.delete({ where: { id: runId } }),
      // Group-only settings are meaningless on a 1:1 package — same clearing
      // the package PATCH does when converting that way round.
      prisma.package.update({
        where: { id: run.packageId },
        data: {
          isGroup: false,
          capacity: null,
          allowDropIn: false,
          dropInPriceCents: null,
          allowWaitlist: false,
          publicEnrollment: false,
        },
      }),
    ])
  } catch (err) {
    console.error('[class-runs] convert-to-package failed', err)
    return NextResponse.json({ error: 'Could not convert this class. Please try again.' }, { status: 500 })
  }

  if (deletedEventIds.length > 0) {
    await deleteGoogleEvents(trainerId, deletedEventIds, null).catch(err =>
      console.error('[class-runs] convert: google cleanup failed', err),
    )
  }

  return NextResponse.json({ ok: true, packageId: run.packageId })
}
