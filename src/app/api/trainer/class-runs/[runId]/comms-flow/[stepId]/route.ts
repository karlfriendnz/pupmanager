import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepPatchSchema, stepWriteData } from '@/lib/comms-flow-steps'

// Update / delete one comms-flow step. Guarded by classes.manage; the step must
// belong to a run the trainer owns (checked via the nested relation filter).

async function ownedStep(trainerId: string, runId: string, stepId: string) {
  return prisma.commsFlowStep.findFirst({
    where: { id: stepId, classRunId: runId, classRun: { trainerId } },
    select: { id: true, audience: true, channels: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ runId: string; stepId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { runId, stepId } = await params
  const existing = await ownedStep(ctx.companyId, runId, stepId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = stepPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const step = await prisma.commsFlowStep.update({ where: { id: stepId }, data: stepWriteData(parsed.data, existing.audience, existing.channels) })
  return NextResponse.json(step)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string; stepId: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { runId, stepId } = await params
  if (!(await ownedStep(ctx.companyId, runId, stepId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.commsFlowStep.delete({ where: { id: stepId } })
  return NextResponse.json({ ok: true })
}
