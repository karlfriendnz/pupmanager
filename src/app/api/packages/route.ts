import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sessionCount: z.number().int().min(1).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const packages = await prisma.package.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { assignments: true } } },
  })
  return NextResponse.json(packages)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Append new packages at the end of the list
  const max = await prisma.package.aggregate({
    where: { trainerId },
    _max: { order: true },
  })
  const nextOrder = (max._max.order ?? -1) + 1

  const pkg = await prisma.package.create({
    data: {
      trainerId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sessionCount: parsed.data.sessionCount,
      weeksBetween: parsed.data.weeksBetween,
      durationMins: parsed.data.durationMins,
      sessionType: parsed.data.sessionType ?? 'IN_PERSON',
      order: nextOrder,
    },
  })
  return NextResponse.json(pkg, { status: 201 })
}
