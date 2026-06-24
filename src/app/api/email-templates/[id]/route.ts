import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().max(60).nullable().optional(),
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(50_000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, category, subject, body, sortOrder } = parsed.data
  // Scope by trainerId so a trainer can only edit their own templates.
  const result = await prisma.emailTemplate.updateMany({
    where: { id, trainerId: tid },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category: category || null } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const template = await prisma.emailTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, subject: true, body: true, sortOrder: true },
  })
  return NextResponse.json({ template })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const result = await prisma.emailTemplate.deleteMany({ where: { id, trainerId: tid } })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
