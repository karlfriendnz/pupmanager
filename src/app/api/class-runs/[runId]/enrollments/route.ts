import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { enrollInRun, ClassError } from '@/lib/class-runs'

// POST /api/class-runs/[runId]/enrollments
// Trainer-assigned enrolment. Capacity / waitlist / drop-in are decided
// server-side inside the transaction (see lib/class-runs.ts).
const schema = z.object({
  clientId: z.string().min(1),
  dogId: z.string().min(1).nullable().optional(),
  type: z.enum(['FULL', 'DROP_IN']).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params

  // Both the run and the client must belong to this trainer.
  const run = await prisma.classRun.findFirst({ where: { id: runId, trainerId }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const client = await prisma.clientProfile.findFirst({
    where: { id: parsed.data.clientId, trainerId },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  try {
    const result = await enrollInRun({
      classRunId: runId,
      clientId: parsed.data.clientId,
      dogId: parsed.data.dogId ?? null,
      type: parsed.data.type ?? 'FULL',
      source: 'TRAINER',
    })
    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      const status = err.code === 'FULL' || err.code === 'ALREADY_ENROLLED' ? 409 : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    throw err
  }
}
