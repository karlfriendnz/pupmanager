import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { MEMBERSHIP_STARTER_STEPS } from '@/lib/comms-flows'
import { stepCreateSchema, withMembershipDefaults, channelsForAudience } from '@/lib/comms-flow-steps'

// List + create the automated-message steps of a membership. Mirrors the
// class-run and 1:1-package routes, but the steps here anchor on the client's
// PURCHASE (there are no sessions to count from), so the starter flow and the
// default direction differ.

async function ownedMembership(trainerId: string, id: string) {
  return prisma.membership.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedMembership(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await prisma.commsFlowStep.findMany({
    where: { membershipId: id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps)
}

const postSchema = z.union([z.object({ seed: z.literal('starter') }), stepCreateSchema])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedMembership(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const last = await prisma.commsFlowStep.findFirst({
    where: { membershipId: id },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  let order = (last?.order ?? -1) + 1

  if ('seed' in parsed.data) {
    await prisma.commsFlowStep.createMany({
      data: MEMBERSHIP_STARTER_STEPS.map(s => ({
        membershipId: id,
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
      where: { membershipId: id },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json(steps, { status: 201 })
  }

  const base = withMembershipDefaults(parsed.data)
  // In-app is staff-only — a client's feed shouldn't mirror every push.
  const fields = { ...base, channels: channelsForAudience(base.channels, base.audience) }
  const step = await prisma.commsFlowStep.create({ data: { membershipId: id, order, ...fields } })
  return NextResponse.json(step, { status: 201 })
}
