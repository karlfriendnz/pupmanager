import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dogId: z.string().optional().nullable(),
})

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('clients.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { taskId } = await params

  // Verify task belongs to this trainer
  const task = await prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId: trainer.id } } },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Verify client access
  const access = await getClientAccess(parsed.data.clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const created = await prisma.trainingTask.create({
    data: {
      clientId: parsed.data.clientId,
      date: new Date(parsed.data.date),
      title: task.title,
      description: task.description,
      repetitions: task.repetitions,
      videoUrl: task.videoUrl,
      dogId: parsed.data.dogId ?? null,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
