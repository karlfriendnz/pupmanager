import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepPatchSchema, stepWriteData, sentFieldsOnly, formStepBlocking, type FlowStepKind } from '@/lib/comms-flow-steps'

// Update / delete one step of a form's journey. Guarded by settings.edit; the
// step must hang off a form the trainer owns (checked via the nested relation
// filter, exactly as the class-runs sibling does).

async function ownedStep(trainerId: string, formId: string, stepId: string) {
  return prisma.commsFlowStep.findFirst({
    where: { id: stepId, formId, form: { trainerId } },
    select: { id: true, audience: true, channels: true, kind: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ formId: string; stepId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId, stepId } = await params
  const existing = await ownedStep(ctx.companyId, formId, stepId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = await req.json().catch(() => ({}))
  const parsed = stepPatchSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Only what was actually sent — zod's `.partial()` keeps every `.default()`,
  // so a patch meaning "turn this off" would otherwise arrive carrying
  // `kind: 'MESSAGE'` and rewrite a FORM step into a message. See sentFieldsOnly.
  //
  // `trigger` is deliberately NOT patchable to null: a journey step whose
  // trigger was cleared would read as BEFORE_SESSION and join the cron's scan.
  const { trigger, blocking, ...rest } = sentFieldsOnly(raw, parsed.data)
  // A step nothing can tick off cannot be waited for — a blocking one would
  // park every person on it for ever. The browser already hides the toggle;
  // this is the half that counts (AGENTS.md bug #3).
  const kind = (rest.kind ?? existing.kind) as FlowStepKind
  const safeBlocking = formStepBlocking(kind, blocking)

  const data = stepWriteData(
    {
      ...rest,
      ...(trigger ? { trigger } : {}),
      ...(safeBlocking === undefined ? {} : { blocking: safeBlocking }),
    },
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
