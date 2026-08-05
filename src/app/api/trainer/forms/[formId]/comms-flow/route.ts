import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { stepCreateSchema, withFormDefaults, channelsForAudience, payloadForWrite } from '@/lib/comms-flow-steps'

// List + create the steps of a FORM's flow — the fourth parent a step can hang
// off, and the only PERSON-anchored one.
//
// A class's steps are reminders on a clock; a form's steps are a journey
// somebody walks (enquiry → account → intake → choose what to book → the
// trainer accepts). Same table, same editor, same CRUD shape as the other three
// so nothing drifts — see the class-runs sibling.
//
// Guarded by settings.edit, which is what gates the form editor this mounts on.

async function ownedForm(trainerId: string, id: string) {
  return prisma.form.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId } = await params
  if (!(await ownedForm(ctx.companyId, formId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await prisma.commsFlowStep.findMany({
    where: { formId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps)
}

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId } = await params
  if (!(await ownedForm(ctx.companyId, formId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = stepCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const last = await prisma.commsFlowStep.findFirst({
    where: { formId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  // withFormDefaults FORCES a person trigger. A step on a form with
  // `trigger: null` would read as BEFORE_SESSION, land in the cron's scan, and
  // fire against a timetable a form does not have.
  const base = withFormDefaults(parsed.data)
  const fields = {
    ...base,
    channels: channelsForAudience(base.channels, base.audience),
    payload: payloadForWrite(base.payload),
  }
  const step = await prisma.commsFlowStep.create({
    data: { formId, order: (last?.order ?? -1) + 1, ...fields },
  })
  return NextResponse.json(step, { status: 201 })
}
