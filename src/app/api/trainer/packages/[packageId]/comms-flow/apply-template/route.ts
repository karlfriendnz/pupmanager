import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { templateStepsSchema, channelsForAudience } from '@/lib/comms-flow-steps'

// Apply a saved template's messages onto this 1:1 package, appended after any
// existing steps. Both the package and the template must belong to the trainer.
const schema = z.object({ templateId: z.string() })

export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [pkg, template] = await Promise.all([
    prisma.package.findFirst({ where: { id: packageId, trainerId: ctx.companyId }, select: { id: true } }),
    prisma.commsFlowTemplate.findFirst({ where: { id: parsed.data.templateId, trainerId: ctx.companyId }, select: { steps: true } }),
  ])
  if (!pkg || !template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const stepsParsed = templateStepsSchema.safeParse(template.steps)
  if (!stepsParsed.success || stepsParsed.data.length === 0) {
    return NextResponse.json({ error: 'This template has no valid messages' }, { status: 400 })
  }

  const last = await prisma.commsFlowStep.findFirst({ where: { packageId }, orderBy: { order: 'desc' }, select: { order: true } })
  let order = (last?.order ?? -1) + 1

  await prisma.commsFlowStep.createMany({ data: stepsParsed.data.map(s => ({ packageId, order: order++, ...s, channels: channelsForAudience(s.channels, s.audience) })) })
  const steps = await prisma.commsFlowStep.findMany({ where: { packageId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })
  return NextResponse.json(steps, { status: 201 })
}
