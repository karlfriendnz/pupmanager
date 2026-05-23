import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// GET  — the roster for one shared class session (every live enrolment
//        plus its attendance row if marked yet).
// PUT  — bulk upsert attendance + per-dog note/scores for that session.
async function ownSession(runId: string, sessionId: string, trainerId: string) {
  return prisma.trainingSession.findFirst({
    where: { id: sessionId, classRunId: runId, classRun: { trainerId } },
    select: { id: true },
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; sessionId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, sessionId } = await params
  if (!(await ownSession(runId, sessionId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const enrollments = await prisma.classEnrollment.findMany({
    where: { classRunId: runId, status: 'ENROLLED' },
    orderBy: { enrolledAt: 'asc' },
    include: {
      client: { select: { user: { select: { name: true } } } },
      dog: { select: { name: true } },
      attendance: { where: { sessionId }, take: 1 },
    },
  })

  return NextResponse.json(
    enrollments.map(e => ({
      enrollmentId: e.id,
      clientName: e.client.user.name,
      dogName: e.dog?.name ?? null,
      type: e.type,
      attendance: e.attendance[0]
        ? {
            status: e.attendance[0].status,
            note: e.attendance[0].note,
            scores: e.attendance[0].scores,
          }
        : null,
    })),
  )
}

const putSchema = z.object({
  records: z
    .array(
      z.object({
        enrollmentId: z.string().min(1),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP']),
        note: z.string().max(4000).nullable().optional(),
        scores: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      }),
    )
    .min(1)
    .max(200),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ runId: string; sessionId: string }> },
) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, sessionId } = await params
  if (!(await ownSession(runId, sessionId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = putSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Only accept enrolments that actually belong to this run.
  const valid = new Set(
    (
      await prisma.classEnrollment.findMany({
        where: { classRunId: runId, id: { in: parsed.data.records.map(r => r.enrollmentId) } },
        select: { id: true },
      })
    ).map(e => e.id),
  )

  const rows = parsed.data.records.filter(r => valid.has(r.enrollmentId))
  await prisma.$transaction(
    rows.map(r =>
      prisma.sessionAttendance.upsert({
        where: { sessionId_enrollmentId: { sessionId, enrollmentId: r.enrollmentId } },
        create: {
          sessionId,
          enrollmentId: r.enrollmentId,
          status: r.status,
          note: r.note ?? null,
          scores: r.scores ?? {},
        },
        update: {
          status: r.status,
          note: r.note ?? null,
          scores: r.scores ?? {},
        },
      }),
    ),
  )

  return NextResponse.json({ ok: true, saved: rows.length })
}
