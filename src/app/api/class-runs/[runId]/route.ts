import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { updateClass, ClassError } from '@/lib/class-runs'

async function ownRun(runId: string, trainerId: string) {
  return prisma.classRun.findFirst({ where: { id: runId, trainerId } })
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
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  startDate: z.string().min(1).optional(),
  sessionCount: z.number().int().min(1).max(52).optional(),
  weeksBetween: z.number().int().min(1).max(8).optional(),
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
      await updateClass({
        runId, trainerId,
        name: d.name,
        scheduleNote: d.scheduleNote ?? null,
        capacity: d.capacity ?? null,
        priceCents: d.priceCents ?? null,
        durationMins: d.durationMins,
        sessionType: d.sessionType,
        startDate,
        sessionCount: d.sessionCount,
        weeksBetween: d.weeksBetween ?? 1,
      })
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof ClassError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      throw err
    }
  }

  // Quick edit — status / simple fields only.
  const run = await prisma.classRun.update({
    where: { id: runId },
    data: {
      ...(d.status !== undefined && { status: d.status }),
      ...(d.name !== undefined && { name: d.name }),
      ...(d.scheduleNote !== undefined && { scheduleNote: d.scheduleNote }),
      ...(d.capacity !== undefined && { capacity: d.capacity }),
    },
  })
  return NextResponse.json({ ok: true, status: run.status })
}

// DELETE = cancel. We never hard-delete a run with history; we mark it
// CANCELLED so past attendance/sessions stay intact. A run that never
// took an enrolment can be removed outright.
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
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    include: { _count: { select: { enrollments: true } } },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (run._count.enrollments === 0) {
    // Sessions cascade via classRunId FK.
    await prisma.classRun.delete({ where: { id: runId } })
    return NextResponse.json({ ok: true, deleted: true })
  }
  await prisma.classRun.update({ where: { id: runId }, data: { status: 'CANCELLED' } })
  return NextResponse.json({ ok: true, cancelled: true })
}
