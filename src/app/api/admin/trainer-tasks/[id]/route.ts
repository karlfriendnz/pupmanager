import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

const patchSchema = z.object({ done: z.boolean() })

// Tick / untick a to-do (stamps completedAt).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  await prisma.adminTrainerTask.updateMany({
    where: { id },
    data: { done: parsed.data.done, completedAt: parsed.data.done ? new Date() : null },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  await prisma.adminTrainerTask.deleteMany({ where: { id } })
  return NextResponse.json({ ok: true })
}
