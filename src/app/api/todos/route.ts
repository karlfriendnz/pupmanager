import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { serializeTodo, todoInclude } from './_serialize'

export const runtime = 'nodejs'

// Company-wide dashboard to-dos. Every query is scoped to ctx.companyId so a
// trainer only ever sees / mutates their own business's items.

// GET — all to-dos for the active company, open first then done, ordered by
// sortOrder within each group.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const todos = await prisma.trainerTodo.findMany({
    where: { companyId: ctx.companyId },
    include: todoInclude,
    orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({ todos: todos.map(serializeTodo) })
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  assignedToId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

// POST — create a to-do. assignedToId, when set, must be a membership in this
// company (so you can't assign work to another business's member).
export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { title, assignedToId, dueDate } = parsed.data

  if (assignedToId) {
    const member = await prisma.trainerMembership.findFirst({
      where: { id: assignedToId, companyId: ctx.companyId },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
  }

  // New items sort to the top of the open list (lowest sortOrder).
  const min = await prisma.trainerTodo.aggregate({
    where: { companyId: ctx.companyId },
    _min: { sortOrder: true },
  })

  const todo = await prisma.trainerTodo.create({
    data: {
      companyId: ctx.companyId,
      createdById: ctx.userId,
      title,
      assignedToId: assignedToId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      sortOrder: (min._min.sortOrder ?? 0) - 1,
    },
    include: todoInclude,
  })

  return NextResponse.json({ todo: serializeTodo(todo) }, { status: 201 })
}
