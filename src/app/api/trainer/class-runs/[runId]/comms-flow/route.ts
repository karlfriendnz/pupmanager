import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { COMMS_STARTER_STEPS } from '@/lib/comms-flows'
import { stepCreateSchema, withDefaults, channelsForAudience, payloadForWrite } from '@/lib/comms-flow-steps'

// List + create the automated-message steps of a class / drop-in / event
// (ClassRun). Guarded by classes.manage and scoped to the trainer's own run.

async function ownedRun(trainerId: string, id: string) {
  return prisma.classRun.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { runId } = await params
  if (!(await ownedRun(ctx.companyId, runId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await prisma.commsFlowStep.findMany({
    where: { classRunId: runId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps)
}

const postSchema = z.union([
  z.object({ seed: z.literal('starter') }),
  stepCreateSchema,
])

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { runId } = await params
  if (!(await ownedRun(ctx.companyId, runId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const last = await prisma.commsFlowStep.findFirst({
    where: { classRunId: runId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  let order = (last?.order ?? -1) + 1

  // Seed the starter flow (a −1 day + a −15 min reminder) in one tap.
  if ('seed' in parsed.data) {
    await prisma.commsFlowStep.createMany({
      data: COMMS_STARTER_STEPS.map(s => ({
        classRunId: runId,
        direction: s.direction,
        offsetMinutes: s.offsetMinutes,
        channels: s.channels,
        important: s.important,
        title: s.title,
        body: s.body,
        order: order++,
      })),
    })
    const steps = await prisma.commsFlowStep.findMany({
      where: { classRunId: runId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json(steps, { status: 201 })
  }

  const base = withDefaults(parsed.data)
  // In-app is staff-only — a client's feed shouldn't mirror every push.
  const fields = { ...base, channels: channelsForAudience(base.channels, base.audience), payload: payloadForWrite(base.payload) }
  const step = await prisma.commsFlowStep.create({
    data: { classRunId: runId, order, ...fields },
  })
  return NextResponse.json(step, { status: 201 })
}
