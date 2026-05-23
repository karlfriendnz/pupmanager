import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  reason: z.string().optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(d => d.startDate <= d.endDate, {
  message: 'End date must be on or after start date',
  path: ['endDate'],
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const blackouts = await prisma.blackoutPeriod.findMany({
    where: { trainerId },
    orderBy: { startDate: 'asc' },
  })
  return NextResponse.json(blackouts.map(b => ({
    ...b,
    startDate: b.startDate.toISOString().split('T')[0],
    endDate: b.endDate.toISOString().split('T')[0],
  })))
}

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const created = await prisma.blackoutPeriod.create({
    data: {
      trainerId,
      reason: parsed.data.reason ?? null,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    },
  })
  return NextResponse.json({
    ...created,
    startDate: created.startDate.toISOString().split('T')[0],
    endDate: created.endDate.toISOString().split('T')[0],
  }, { status: 201 })
}
