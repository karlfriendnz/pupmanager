import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Super-admin internal notes about a trainer business (progress diary). Not
// visible to the trainer. trainerId is the TrainerProfile.id.
async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const schema = z.object({
  trainerId: z.string().min(1),
  body: z.string().trim().min(1, 'Write a note').max(5000),
})

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const note = await prisma.adminTrainerNote.create({
    data: { trainerId: parsed.data.trainerId, body: parsed.data.body, createdById: session.user.id },
  })
  return NextResponse.json({ ok: true, note }, { status: 201 })
}
