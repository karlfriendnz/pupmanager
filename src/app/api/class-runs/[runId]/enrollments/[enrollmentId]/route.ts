import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { withdrawEnrollment, ClassError } from '@/lib/class-runs'

// DELETE /api/class-runs/[runId]/enrollments/[enrollmentId]
// Withdraw an enrolment. If it freed a real seat, lib/class-runs auto-
// promotes the next waitlisted enrolment; we then drop the promoted
// client an in-app notification (best-effort, never blocks the withdraw).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ runId: string; enrollmentId: string }> },
) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, enrollmentId } = await params

  // Scope the enrolment to a run this trainer owns.
  const enr = await prisma.classEnrollment.findFirst({
    where: { id: enrollmentId, classRunId: runId, classRun: { trainerId } },
    select: { id: true },
  })
  if (!enr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const { promotedEnrollmentId } = await withdrawEnrollment(enrollmentId)

    if (promotedEnrollmentId) {
      const promoted = await prisma.classEnrollment.findUnique({
        where: { id: promotedEnrollmentId },
        select: { clientId: true, classRun: { select: { name: true } } },
      })
      if (promoted) {
        await prisma.clientNotification
          .create({
            data: {
              clientId: promoted.clientId,
              trainerId,
              subject: `You're off the waitlist for ${promoted.classRun.name}`,
              notes: `A spot opened up and you've been enrolled in ${promoted.classRun.name}.`,
            },
          })
          .catch(e => console.error('[class withdraw] promote notify failed', e))
      }
    }
    return NextResponse.json({ ok: true, promotedEnrollmentId })
  } catch (err) {
    if (err instanceof ClassError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    throw err
  }
}
