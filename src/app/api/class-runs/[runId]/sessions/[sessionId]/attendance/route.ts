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
  const sess = await prisma.trainingSession.findFirst({
    where: { id: sessionId, classRunId: runId, classRun: { trainerId } },
    select: { id: true, sessionFormId: true, classRun: { select: { package: { select: { defaultSessionFormId: true } } } } },
  })
  if (!sess) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Effective form for this session: per-session override, else the class default.
  const effectiveFormId = sess.sessionFormId ?? sess.classRun?.package?.defaultSessionFormId ?? null

  const [effectiveForm, availableForms, enrollments] = await Promise.all([
    effectiveFormId
      ? prisma.sessionForm.findFirst({ where: { id: effectiveFormId, trainerId }, select: { id: true, name: true, questions: true } })
      : Promise.resolve(null),
    prisma.sessionForm.findMany({ where: { trainerId }, orderBy: [{ order: 'asc' }, { createdAt: 'desc' }], select: { id: true, name: true, questions: true } }),
    prisma.classEnrollment.findMany({
      where: { classRunId: runId, status: 'ENROLLED' },
      orderBy: { enrolledAt: 'asc' },
      include: {
        client: { select: { user: { select: { name: true } } } },
        dog: { select: { name: true, photoUrl: true, breed: true } },
        attendance: { where: { sessionId }, take: 1 },
      },
    }),
  ])

  return NextResponse.json({
    sessionFormId: sess.sessionFormId,
    effectiveForm,
    availableForms,
    roster: enrollments.map(e => ({
      enrollmentId: e.id,
      clientName: e.client.user.name,
      dogName: e.dog?.name ?? null,
      dogPhotoUrl: e.dog?.photoUrl ?? null,
      dogBreed: e.dog?.breed ?? null,
      type: e.type,
      status: e.attendance[0]?.status ?? 'PRESENT',
      note: e.attendance[0]?.note ?? '',
      hasReport: !!e.attendance[0]?.report,
      report: (e.attendance[0]?.report ?? null) as { answers?: Record<string, string>; intro?: string | null; closing?: string | null } | null,
    })),
  })
}

const putSchema = z.object({
  // Per-session form override (the form used to write up this session). null
  // clears the override back to the class default. Omit to leave unchanged.
  sessionFormId: z.string().nullable().optional(),
  records: z
    .array(
      z.object({
        enrollmentId: z.string().min(1),
        // Attendance phase (taken at the session). All optional so the notes
        // phase can save a report later without resending these.
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP']).optional(),
        note: z.string().max(4000).nullable().optional(),
        // Notes phase (written up later): this client's own filled form.
        report: z
          .object({
            formId: z.string().nullable().optional(),
            answers: z.record(z.string(), z.string()).optional(),
            intro: z.string().max(4000).nullable().optional(),
            closing: z.string().max(4000).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
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

  // Per-session form override.
  if (parsed.data.sessionFormId !== undefined) {
    await prisma.trainingSession.update({
      where: { id: sessionId },
      data: { sessionFormId: parsed.data.sessionFormId },
    })
  }

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
    rows.map(r => {
      const report = r.report
        ? {
            formId: r.report.formId ?? null,
            answers: r.report.answers ?? {},
            intro: r.report.intro ?? null,
            closing: r.report.closing ?? null,
          }
        : undefined
      // Update only the fields this save provided, so the attendance phase and
      // the (later) notes phase don't clobber each other.
      return prisma.sessionAttendance.upsert({
        where: { sessionId_enrollmentId: { sessionId, enrollmentId: r.enrollmentId } },
        create: {
          sessionId,
          enrollmentId: r.enrollmentId,
          status: r.status ?? 'PRESENT',
          ...(r.note !== undefined && { note: r.note }),
          ...(report && { report }),
        },
        update: {
          ...(r.status !== undefined && { status: r.status }),
          ...(r.note !== undefined && { note: r.note }),
          ...(report && { report }),
        },
      })
    }),
  )

  return NextResponse.json({ ok: true, saved: rows.length })
}
