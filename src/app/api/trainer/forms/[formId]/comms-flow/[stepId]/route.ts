import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepPatchSchema, stepWriteData } from '@/lib/comms-flow-steps'

// Update / delete one step of a form's journey. Guarded by settings.edit; the
// step must hang off a form the trainer owns (checked via the nested relation
// filter, exactly as the class-runs sibling does).

async function ownedStep(trainerId: string, formId: string, stepId: string) {
  return prisma.commsFlowStep.findFirst({
    where: { id: stepId, formId, form: { trainerId } },
    select: { id: true, audience: true, channels: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ formId: string; stepId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId, stepId } = await params
  const existing = await ownedStep(ctx.companyId, formId, stepId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = stepPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // `trigger` is deliberately NOT patchable to null here: a journey step whose
  // trigger was cleared would read as BEFORE_SESSION and join the cron's scan.
  const { trigger, ...rest } = parsed.data
  const data = stepWriteData(
    { ...rest, ...(trigger ? { trigger } : {}) },
    existing.audience,
    existing.channels,
  )

  const step = await prisma.commsFlowStep.update({ where: { id: stepId }, data })
  return NextResponse.json(step)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ formId: string; stepId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId, stepId } = await params
  if (!(await ownedStep(ctx.companyId, formId, stepId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.commsFlowStep.delete({ where: { id: stepId } })
  return NextResponse.json({ ok: true })
}
