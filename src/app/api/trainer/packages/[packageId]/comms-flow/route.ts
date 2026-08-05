import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { COMMS_STARTER_STEPS } from '@/lib/comms-flows'
import { stepCreateSchema, withDefaults, channelsForAudience, payloadForWrite } from '@/lib/comms-flow-steps'

// List + create the automated-message steps of a 1:1 package. Mirrors the
// class-run comms-flow route; scoped to the trainer's own package and gated by
// packages.manage.

async function ownedPackage(trainerId: string, id: string) {
  return prisma.package.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  if (!(await ownedPackage(ctx.companyId, packageId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await prisma.commsFlowStep.findMany({
    where: { packageId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps)
}

const postSchema = z.union([z.object({ seed: z.literal('starter') }), stepCreateSchema])

export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  if (!(await ownedPackage(ctx.companyId, packageId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const last = await prisma.commsFlowStep.findFirst({
    where: { packageId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  let order = (last?.order ?? -1) + 1

  if ('seed' in parsed.data) {
    await prisma.commsFlowStep.createMany({
      data: COMMS_STARTER_STEPS.map(s => ({
        packageId,
        direction: s.direction,
        offsetMinutes: s.offsetMinutes,
        channels: s.channels,
        important: s.important,
        title: s.title,
        body: s.body,
        order: order++,
      })),
    })
    const steps = await prisma.commsFlowStep.findMany({ where: { packageId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })
    return NextResponse.json(steps, { status: 201 })
  }

  const base = withDefaults(parsed.data)
  // In-app is staff-only — a client's feed shouldn't mirror every push.
  const fields = { ...base, channels: channelsForAudience(base.channels, base.audience), payload: payloadForWrite(base.payload) }
  const step = await prisma.commsFlowStep.create({ data: { packageId, order, ...fields } })
  return NextResponse.json(step, { status: 201 })
}
