import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveSessionForm } from '@/lib/session-form'
import { releaseRecaps } from '@/lib/recap-notify'
import { isSessionDone } from '@/lib/report-visibility'

// GET  — the roster for one shared class session (every live enrolment
//        plus its attendance row if marked yet).
// PUT  — bulk upsert attendance + per-dog note/scores for that session.
async function ownSession(runId: string, sessionId: string, trainerId: string) {
  return prisma.trainingSession.findFirst({
    where: { id: sessionId, classRunId: runId, classRun: { trainerId } },
    select: { id: true, status: true, scheduledAt: true },
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
  const classDefaultFormId = sess.classRun?.package?.defaultSessionFormId ?? null
  // The session's own answer, for the roster rows that don't have their own.
  const effectiveFormId = resolveSessionForm({
    sessionFormId: sess.sessionFormId,
    classDefaultFormId,
  }).formId

  const [effectiveForm, availableForms, enrollments] = await Promise.all([
    effectiveFormId
      ? prisma.sessionForm.findFirst({ where: { id: effectiveFormId, trainerId }, select: { id: true, name: true, questions: true } })
      : Promise.resolve(null),
    // Every form the trainer has. The roster resolves per row, so a client on a
    // different form needs ITS questions available too — loading only the
    // session's form would leave their write-up with nothing to ask.
    prisma.sessionForm.findMany({ where: { trainerId }, orderBy: [{ order: 'asc' }, { createdAt: 'desc' }], select: { id: true, name: true, questions: true } }),
    prisma.classEnrollment.findMany({
      // The roster for THIS session: every full-course enrolee (they attend
      // every session) plus the drop-ins booked onto this one specific session.
      // A drop-in must not appear on sessions they aren't attending.
      where: {
        classRunId: runId,
        status: 'ENROLLED',
        OR: [{ type: 'FULL' }, { type: 'DROP_IN', dropInSessionId: sessionId }],
      },
      orderBy: { enrolledAt: 'asc' },
      include: {
        client: { select: { user: { select: { name: true } } } },
        dog: { select: { name: true, photoUrl: true, breed: true, deceasedAt: true } },
        attendance: { where: { sessionId }, take: 1 },
      },
    }),
  ])

  return NextResponse.json({
    sessionFormId: sess.sessionFormId,
    effectiveForm,
    availableForms,
    // A dog that has died drops off the register — but only where there is
    // nothing to preserve. If they were already marked for THIS session that
    // row is a record of a session they really attended, so it stays.
    roster: enrollments.filter(e => !e.dog?.deceasedAt || e.attendance.length > 0).map(e => ({
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
      // THIS client's form. A class is one group but not one kind of client — a
      // puppy on foundations and a dog in for reactivity need different questions
      // answered on the same night. `formSource` says which level decided, so the
      // roster can mark the ones that differ from everyone else.
      ...(() => {
        const r = resolveSessionForm({
          enrollmentFormId: e.sessionFormId,
          sessionFormId: sess.sessionFormId,
          classDefaultFormId,
        })
        return { formId: r.formId, formSource: r.from, ownFormId: e.sessionFormId }
      })(),
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
        /**
         * THIS CLIENT's form for the whole class, not just this session. A string
         * sets it; null clears it back to whatever the session or class says; OMIT
         * leaves it alone — which matters because attendance saves send a record
         * per person and must not wipe an override nobody touched.
         */
        ownFormId: z.string().nullable().optional(),
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
  const owned = await ownSession(runId, sessionId, trainerId)
  if (!owned) {
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

  // A client's own form lives on the ENROLMENT, not on this session's attendance —
  // it's "Rex is in for reactivity", which is true every week, not just tonight.
  // Only rows that actually said something are touched: `undefined` means "leave
  // it alone", and an attendance save sends a record per person, so treating
  // omission as null would wipe every override on the register.
  const formChanges = rows.filter(r => r.ownFormId !== undefined)
  if (formChanges.length > 0) {
    await prisma.$transaction(
      formChanges.map(r => prisma.classEnrollment.update({
        where: { id: r.enrollmentId },
        data: { sessionFormId: r.ownFormId ?? null },
      })),
    )
  }

  // A per-attendee report follows exactly the same rule as a 1:1 write-up — it
  // is the same promise to the same person, so it would be indefensible for one
  // of them to need a Send button and the other not to. What differs is where
  // the switch is: a class session has no Mark complete control anywhere in the
  // app, so taking the register IS the trainer saying this session ran, and the
  // save below marks it done (once it is actually in the past).
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

  // Taking the register on a session that has already happened marks it done.
  // Deliberately gated on the clock: a trainer pre-filling next week's roster
  // has not run anything, and marking a future session complete would publish
  // its write-up early and drag its practice homework forward with it.
  if (owned.status === 'UPCOMING' && owned.scheduledAt.getTime() <= Date.now()) {
    await prisma.trainingSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    })
  }

  // …and publishing it tells the people it is about. One notification each,
  // however many attendees were written up in this one save.
  if (isSessionDone(owned.status) || owned.scheduledAt.getTime() <= Date.now()) {
    try {
      await releaseRecaps({ trainerId, sessionIds: [sessionId] })
    } catch {
      // Never lose a saved register to a failed push.
    }
  }

  return NextResponse.json({ ok: true, saved: rows.length })
}
