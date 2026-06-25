import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createClassRun, createClassWithPackage, ClassError } from '@/lib/class-runs'

// GET  /api/class-runs        — every run for the trainer (+ enrolled count)
// POST /api/class-runs        — create a run + its shared session series
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runs = await prisma.classRun.findMany({
    where: { trainerId },
    orderBy: [{ startDate: 'desc' }],
    include: {
      package: { select: { id: true, name: true, color: true, capacity: true, sessionCount: true } },
      _count: { select: { sessions: true } },
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
    },
  })
  return NextResponse.json(
    runs.map(r => ({
      id: r.id,
      name: r.name,
      scheduleNote: r.scheduleNote,
      startDate: r.startDate.toISOString(),
      status: r.status,
      capacity: r.capacity ?? r.package.capacity ?? null,
      sessionCount: r._count.sessions,
      enrolledCount: r.enrollments.length,
      package: r.package,
    })),
  )
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  startDate: z.string().min(1),
  scheduleNote: z.string().max(120).nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  // One-step create (no existing package): the class's own settings.
  sessionCount: z.number().int().min(1).max(52).optional(),
  weeksBetween: z.number().int().min(1).max(8).optional(),
  durationMins: z.number().int().min(5).max(600).optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  priceCents: z.number().int().min(0).max(10_000_00).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  // TrainerMembership ids (of this company) to assign as the class's trainers.
  assignedMembershipIds: z.array(z.string()).optional(),
  // Legacy: run off an existing group package.
  packageId: z.string().min(1).optional(),
})

export async function POST(req: Request) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const startDate = new Date(d.startDate)
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
  }

  try {
    if (d.packageId) {
      // Legacy path: schedule a run off an existing group package.
      const run = await createClassRun({
        trainerId, packageId: d.packageId, name: d.name, startDate,
        scheduleNote: d.scheduleNote ?? null, capacity: d.capacity ?? null,
      })
      return NextResponse.json({ ok: true, ...run }, { status: 201 })
    }

    // One-step path: needs the inline class settings.
    if (d.sessionCount == null || d.durationMins == null || !d.sessionType) {
      return NextResponse.json({ error: 'Missing class settings' }, { status: 400 })
    }
    const run = await createClassWithPackage({
      trainerId,
      name: d.name,
      startDate,
      sessionCount: d.sessionCount,
      weeksBetween: d.weeksBetween ?? 1,
      durationMins: d.durationMins,
      sessionType: d.sessionType,
      priceCents: d.priceCents ?? null,
      capacity: d.capacity ?? null,
      color: d.color ?? null,
      scheduleNote: d.scheduleNote ?? null,
      defaultSessionFormId: d.defaultSessionFormId ?? null,
      imageUrl: d.imageUrl ?? null,
      assignedMembershipIds: d.assignedMembershipIds,
    })
    return NextResponse.json({ ok: true, ...run }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    throw err
  }
}
