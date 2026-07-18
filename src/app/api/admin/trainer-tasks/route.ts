import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Super-admin internal to-dos against a trainer business. trainerId is the
// TrainerProfile.id.
async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const schema = z.object({
  trainerId: z.string().min(1),
  title: z.string().trim().min(1, 'Write a task').max(500),
})

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const task = await prisma.adminTrainerTask.create({
    data: { trainerId: parsed.data.trainerId, title: parsed.data.title, createdById: session.user.id },
  })
  return NextResponse.json({ ok: true, task }, { status: 201 })
}
