import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepPatchSchema } from '@/lib/comms-flow-steps'

// Update / delete one comms-flow step on a 1:1 package. The step must belong to
// a package the trainer owns.
async function ownedStep(trainerId: string, packageId: string, stepId: string) {
  return prisma.commsFlowStep.findFirst({
    where: { id: stepId, packageId, package: { trainerId } },
    select: { id: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ packageId: string; stepId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId, stepId } = await params
  if (!(await ownedStep(ctx.companyId, packageId, stepId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = stepPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const step = await prisma.commsFlowStep.update({ where: { id: stepId }, data: parsed.data })
  return NextResponse.json(step)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ packageId: string; stepId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId, stepId } = await params
  if (!(await ownedStep(ctx.companyId, packageId, stepId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.commsFlowStep.delete({ where: { id: stepId } })
  return NextResponse.json({ ok: true })
}
