import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { templateStepsSchema } from '@/lib/comms-flow-steps'

// Apply a saved template's messages onto this run, appended after any existing
// steps. Both the run and the template must belong to the trainer.
const schema = z.object({ templateId: z.string() })

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { runId } = await params

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [run, template] = await Promise.all([
    prisma.classRun.findFirst({ where: { id: runId, trainerId: ctx.companyId }, select: { id: true } }),
    prisma.commsFlowTemplate.findFirst({
      where: { id: parsed.data.templateId, trainerId: ctx.companyId },
      select: { steps: true },
    }),
  ])
  if (!run || !template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const stepsParsed = templateStepsSchema.safeParse(template.steps)
  if (!stepsParsed.success || stepsParsed.data.length === 0) {
    return NextResponse.json({ error: 'This template has no valid messages' }, { status: 400 })
  }

  const last = await prisma.commsFlowStep.findFirst({
    where: { classRunId: runId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  let order = (last?.order ?? -1) + 1

  await prisma.commsFlowStep.createMany({
    data: stepsParsed.data.map(s => ({ classRunId: runId, order: order++, ...s })),
  })
  const steps = await prisma.commsFlowStep.findMany({
    where: { classRunId: runId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps, { status: 201 })
}
