import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { serializeTodo, todoInclude } from '../_serialize'

export const runtime = 'nodejs'

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  // null clears the assignment; a string assigns (validated against the company).
  assignedToId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

// PATCH — toggle done, edit the title, (un)assign, or set a due date. Scoped to
// ctx.companyId so a trainer can only touch their own business's items.
export async function PATCH(req: Request, { params }: { params: Promise<{ todoId: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { todoId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const existing = await prisma.trainerTodo.findFirst({
    where: { id: todoId, companyId: ctx.companyId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { title, done, assignedToId, dueDate } = parsed.data

  // Validate any new assignee belongs to this company.
  if (assignedToId) {
    const member = await prisma.trainerMembership.findFirst({
      where: { id: assignedToId, companyId: ctx.companyId },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
  }

  const todo = await prisma.trainerTodo.update({
    where: { id: todoId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(done !== undefined ? { done, completedAt: done ? new Date() : null } : {}),
      ...(assignedToId !== undefined ? { assignedToId } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    },
    include: todoInclude,
  })

  return NextResponse.json({ todo: serializeTodo(todo) })
}

// DELETE — remove a to-do.
export async function DELETE(_req: Request, { params }: { params: Promise<{ todoId: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { todoId } = await params

  const result = await prisma.trainerTodo.deleteMany({
    where: { id: todoId, companyId: ctx.companyId },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
