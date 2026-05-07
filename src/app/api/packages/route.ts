import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  // 0 = ongoing (no fixed end). The trainer picks an end date when assigning.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  // Prices stored in cents. Accept 0 (free) up to a sane upper bound.
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  specialPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // Tailwind palette key. Keep this list in sync with PACKAGE_COLORS in
  // schedule-view.tsx — both must include any new option.
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  requireSessionNotes: z.boolean().optional(),
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
      priceCents: parsed.data.priceCents ?? null,
      specialPriceCents: parsed.data.specialPriceCents ?? null,
      color: parsed.data.color ?? null,
      defaultSessionFormId: parsed.data.defaultSessionFormId ?? null,
      requireSessionNotes: parsed.data.requireSessionNotes ?? true,
      order: nextOrder,
    },
  })
  return NextResponse.json(pkg, { status: 201 })
}
