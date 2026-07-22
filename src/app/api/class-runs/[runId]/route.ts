import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { updateClass, ClassError } from '@/lib/class-runs'
import { MAX_BUFFER_MINS } from '@/lib/buffer'
import { notifyClient } from '@/lib/client-notify'

async function ownRun(runId: string, trainerId: string) {
  return prisma.classRun.findFirst({ where: { id: runId, trainerId } })
}

// Tell every enrolled client about a class change (reschedule / cancellation).
async function notifyRunClients(opts: { runId: string; trainerId: string; planName: string; detail: string; link: string; sessions?: { when: string }[] }) {
  const enrollments = await prisma.classEnrollment.findMany({
    where: { classRunId: opts.runId, status: 'ENROLLED' },
    select: { client: { select: { userId: true } }, dog: { select: { name: true } } },
  })
  for (const e of enrollments) {
    if (!e.client?.userId) continue
    await notifyClient({
      userId: e.client.userId, trainerId: opts.trainerId, type: 'CLIENT_SESSION_CHANGED',
      vars: { dogName: e.dog?.name ?? 'your dog', planName: opts.planName, detail: opts.detail },
      link: opts.link, ctaLabel: 'View class', sessions: opts.sessions,
    })
  }
}

// GET /api/class-runs/[runId] — run detail: sessions + roster + waitlist.
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    include: {
      package: true,
      sessions: {
        orderBy: { sessionIndex: 'asc' },
        select: { id: true, title: true, scheduledAt: true, sessionIndex: true, status: true },
      },
      enrollments: {
        orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { enrolledAt: 'asc' }],
        include: {
          client: { select: { id: true, user: { select: { name: true, email: true } } } },
          dog: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: run.id,
    name: run.name,
    scheduleNote: run.scheduleNote,
    startDate: run.startDate.toISOString(),
    status: run.status,
    capacity: run.capacity ?? run.package.capacity ?? null,
    package: { id: run.package.id, name: run.package.name, allowDropIn: run.package.allowDropIn, allowWaitlist: run.package.allowWaitlist },
    sessions: run.sessions.map(s => ({ ...s, scheduledAt: s.scheduledAt.toISOString() })),
    enrollments: run.enrollments.map(e => ({
      id: e.id,
      status: e.status,
      type: e.type,
      waitlistPosition: e.waitlistPosition,
      joinedAtIndex: e.joinedAtIndex,
      source: e.source,
      clientId: e.clientId,
      clientName: e.client.user.name,
      clientEmail: e.client.user.email,
      dogId: e.dogId,
      dogName: e.dog?.name ?? null,
    })),
  })
}

const patchSchema = z.object({
  // Status-only quick edit (the dropdown).
  status: z.enum(['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED']).optional(),
  // Full edit (the "Edit class" form). Presence of startDate marks a full edit.
  name: z.string().min(1).max(120).optional(),
  scheduleNote: z.string().max(120).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_00).nullable().optional(),
  durationMins: z.number().int().min(5).max(600).optional(),
  // "Gap before the next session" — travel / clean-up time after each class.
  bufferMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  startDate: z.string().min(1).optional(),
  sessionCount: z.number().int().min(1).max(52).optional(),
  weeksBetween: z.number().int().min(1).max(8).optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  assignedMembershipIds: z.array(z.string()).optional(),
  // Tri-state "require payment to enrol": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  if (!(await ownRun(runId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // Full edit — the form sends the complete class settings.
  if (d.startDate != null && d.name != null && d.sessionCount != null && d.durationMins != null && d.sessionType) {
    const startDate = new Date(d.startDate)
    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
    }
    try {
      const result = await updateClass({
        runId, trainerId,
        name: d.name,
        scheduleNote: d.scheduleNote ?? null,
        capacity: d.capacity ?? null,
        priceCents: d.priceCents ?? null,
        durationMins: d.durationMins,
        bufferMins: d.bufferMins,
        sessionType: d.sessionType,
        startDate,
        sessionCount: d.sessionCount,
        weeksBetween: d.weeksBetween ?? 1,
        defaultSessionFormId: d.defaultSessionFormId,
        imageUrl: d.imageUrl,
        location: d.location,
        description: d.description,
        assignedMembershipIds: d.assignedMembershipIds,
        requirePayment: d.requirePayment,
      })
      // Keep Google Calendar in step with a rebuild: remove the deleted
      // sessions' mirrored events, then mirror the freshly-created ones.
      // Best-effort — a calendar failure must never break the edit.
      if (result.scheduleChanged) {
        try {
          const { syncSessionsToGoogle, deleteGoogleEvents } = await import('@/lib/google-calendar-sync')
          if (result.deletedEventIds.length) await deleteGoogleEvents(trainerId, result.deletedEventIds)
          await syncSessionsToGoogle(result.createdSessionIds)
        } catch {
          // Non-critical
        }
      }
      // Only a genuine time change regenerates sessions — notify clients then.
      if (result.scheduleChanged) {
        const runDetail = await prisma.classRun.findUnique({
          where: { id: runId },
          select: {
            name: true,
            // The class time is a physical instant in the TRAINER's locale, so
            // client-facing times render in the trainer's timezone (not the
            // server's UTC — which showed a 3pm class as "3am").
            trainer: { select: { user: { select: { timezone: true } } } },
            sessions: { where: { scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' }, select: { scheduledAt: true } },
          },
        })
        const tz = runDetail?.trainer?.user?.timezone ?? 'Pacific/Auckland'
        await notifyRunClients({
          runId, trainerId, planName: runDetail?.name ?? d.name,
          detail: 'Rescheduled — here are the new times',
          link: '/my-sessions',
          sessions: (runDetail?.sessions ?? []).map(s => ({ when: s.scheduledAt.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) })),
        })
      }
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof ClassError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      throw err
    }
  }

  // Quick edit — status / simple fields only.
  const before = await prisma.classRun.findUnique({ where: { id: runId }, select: { status: true, name: true } })
  const run = await prisma.classRun.update({
    where: { id: runId },
    data: {
      ...(d.status !== undefined && { status: d.status }),
      ...(d.name !== undefined && { name: d.name }),
      ...(d.scheduleNote !== undefined && { scheduleNote: d.scheduleNote }),
      ...(d.capacity !== undefined && { capacity: d.capacity }),
      ...(d.requirePayment !== undefined && { requirePayment: d.requirePayment }),
    },
  })
  // Notify enrolled clients when a class is newly cancelled.
  if (d.status === 'CANCELLED' && before?.status !== 'CANCELLED') {
    // NOTE: the sessions stay UPCOMING — SessionStatus has no CANCELLED
    // member, and adding one would ripple through every status switch in the
    // UI. The reminder crons therefore exclude sessions whose RUN is cancelled
    // (see the cron where-clauses); that's what stops a cancelled class
    // announcing itself. They do remain visible on /schedule, which is a
    // separate decision from whether anyone gets notified.
    await notifyRunClients({ runId, trainerId, planName: before?.name ?? 'your class', detail: 'This class has been cancelled', link: '/my-sessions' })
  }
  return NextResponse.json({ ok: true, status: run.status })
}

// DELETE = delete. The class, its sessions, its enrolments and their
// attendance all go, in one transaction. (It used to soft-cancel any run that
// had ever taken an enrolment, which read to trainers as "delete does
// nothing" — the class and its sessions stayed on the schedule.) Enrolled
// clients are told the class is cancelled BEFORE the rows go, since the
// notification needs the enrolments to still exist. Payment history survives:
// PaymentItem.classEnrollmentId / trainingSessionId are SetNull.
export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  // Tenant guard: only a run owned by THIS company can be deleted.
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    select: {
      id: true,
      name: true,
      // Capture the mirrored Google event ids BEFORE the cascade wipes them, so
      // we can remove them from the trainer's calendar after the local delete.
      sessions: { select: { googleCalendarEventId: true } },
    },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deletedEventIds = run.sessions
    .map((s) => s.googleCalendarEventId)
    .filter((id): id is string => !!id)

  // Best-effort — a flaky email/push must not block the delete.
  try {
    await notifyRunClients({
      runId, trainerId, planName: run.name,
      detail: 'This class has been cancelled', link: '/my-sessions',
    })
  } catch (err) {
    console.error('[class-runs] delete: notifying clients failed', err)
  }

  try {
    await prisma.$transaction([
      // Sessions/enrolments cascade off the run at the FK level, but delete
      // the sessions explicitly (scoped to the tenant) so the intent is
      // enforced here, not just by the DB.
      prisma.trainingSession.deleteMany({ where: { classRunId: runId, trainerId } }),
      prisma.classRun.delete({ where: { id: runId } }),
    ])
  } catch (err) {
    console.error('[class-runs] delete failed', err)
    return NextResponse.json({ error: 'Could not delete this class. Please try again.' }, { status: 500 })
  }

  // Best-effort: pull the class's now-deleted sessions off the trainer's Google
  // Calendar. Unassigned class sessions live on the owner's connection (the sync
  // engine's fallback). Never blocks the delete.
  if (deletedEventIds.length) {
    try {
      const { deleteGoogleEvents } = await import('@/lib/google-calendar-sync')
      await deleteGoogleEvents(trainerId, deletedEventIds)
    } catch {
      // Non-critical
    }
  }

  return NextResponse.json({ ok: true, deleted: true })
}
