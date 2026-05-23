import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createClassRun, ClassError } from '@/lib/class-runs'

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
  packageId: z.string().min(1),
  name: z.string().min(1).max(120),
  startDate: z.string().min(1),
  scheduleNote: z.string().max(120).nullable().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
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

  const startDate = new Date(parsed.data.startDate)
  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
  }

  try {
    const run = await createClassRun({
      trainerId,
      packageId: parsed.data.packageId,
      name: parsed.data.name,
      startDate,
      scheduleNote: parsed.data.scheduleNote ?? null,
      capacity: parsed.data.capacity ?? null,
    })
    return NextResponse.json({ ok: true, ...run }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    throw err
  }
}
