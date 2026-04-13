import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  title: z.string().optional(),
  dayOfWeek: z.number().int().min(1).max(7).optional().nullable(),
  date: z.string().optional().nullable(),       // ISO date string for one-off
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const slots = await prisma.availabilitySlot.findMany({
    where: { trainerId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  })

  return NextResponse.json(slots)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const slot = await prisma.availabilitySlot.create({
    data: {
      trainerId,
      title: parsed.data.title ?? null,
      dayOfWeek: parsed.data.dayOfWeek ?? null,
      date: parsed.data.date ? new Date(parsed.data.date) : null,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    },
  })

  return NextResponse.json(slot, { status: 201 })
}
