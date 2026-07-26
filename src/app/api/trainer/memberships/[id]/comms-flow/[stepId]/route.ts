import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepPatchSchema, normalizeStepChannels } from '@/lib/comms-flow-steps'

// Update / delete one comms-flow step on a membership. The step must belong to
// a membership the trainer owns.
async function ownedStep(trainerId: string, membershipId: string, stepId: string) {
  return prisma.commsFlowStep.findFirst({
    where: { id: stepId, membershipId, membership: { trainerId } },
    select: { id: true, audience: true, channels: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id, stepId } = await params
  const existing = await ownedStep(ctx.companyId, id, stepId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = stepPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const step = await prisma.commsFlowStep.update({ where: { id: stepId }, data: normalizeStepChannels(parsed.data, existing.audience, existing.channels) })
  return NextResponse.json(step)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id, stepId } = await params
  if (!(await ownedStep(ctx.companyId, id, stepId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.commsFlowStep.delete({ where: { id: stepId } })
  return NextResponse.json({ ok: true })
}
