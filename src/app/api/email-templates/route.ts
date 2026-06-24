import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Trainer-owned, reusable email templates. GET lists the signed-in trainer's
// templates (used by the Messages composer picker); POST creates one.

const createSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(60).nullable().optional(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

export async function GET() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const templates = await prisma.emailTemplate.findMany({
    where: { trainerId: tid },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, category: true, subject: true, body: true, sortOrder: true },
  })
  return NextResponse.json({ templates })
}

export async function POST(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, category, subject, body, sortOrder } = parsed.data
  const template = await prisma.emailTemplate.create({
    data: { trainerId: tid, name, category: category || null, subject, body, sortOrder: sortOrder ?? 0 },
    select: { id: true, name: true, category: true, subject: true, body: true, sortOrder: true },
  })
  return NextResponse.json({ template })
}
