import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  label: z.string().min(1),
  type: z.enum(['TEXT', 'NUMBER', 'DROPDOWN']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  order: z.number().default(0),
  category: z.string().nullable().optional(),
  appliesTo: z.enum(['OWNER', 'DOG']).default('OWNER'),
})

async function getTrainerId(userId: string) {
  const p = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  return p?.id ?? null
}

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = await getTrainerId(session.user.id)
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const fields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(fields)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = await getTrainerId(session.user.id)
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const count = await prisma.customField.count({ where: { trainerId } })
  const field = await prisma.customField.create({
    data: {
      trainerId,
      label: parsed.data.label,
      type: parsed.data.type,
      required: parsed.data.required,
      options: parsed.data.options && parsed.data.options.length > 0 ? parsed.data.options : undefined,
      order: count,
      category: parsed.data.category ?? null,
      appliesTo: parsed.data.appliesTo,
    },
  })
  return NextResponse.json(field, { status: 201 })
}
