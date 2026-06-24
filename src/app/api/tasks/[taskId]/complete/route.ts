import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { notifyTrainer } from '@/lib/trainer-notify'
import { z } from 'zod'

const schema = z.object({
  note: z.string().optional(),
  videoUrl: z.string().url().optional().or(z.literal('')),
  videoS3Key: z.string().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { taskId } = await params
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Verify the task belongs to one of this user's client profiles (any trainer).
  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, client: { userId: session.user.id } },
    select: { id: true, clientId: true },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // Was it already complete? Only a fresh completion can be the one that clears
  // the list — editing a note on an already-done task shouldn't re-notify.
  const wasComplete = !!(await prisma.taskCompletion.findUnique({ where: { taskId }, select: { taskId: true } }))

  const completion = await prisma.taskCompletion.upsert({
    where: { taskId },
    create: {
      taskId,
      note: parsed.data.note || null,
      videoUrl: parsed.data.videoUrl || null,
      videoS3Key: parsed.data.videoS3Key || null,
    },
    update: {
      note: parsed.data.note || null,
      videoUrl: parsed.data.videoUrl || null,
      videoS3Key: parsed.data.videoS3Key || null,
    },
  })

  await safeEvaluate(task.clientId)

  // Tell the trainer when this completion clears the client's whole task list.
  if (!wasComplete) {
    const [total, done] = await Promise.all([
      prisma.trainingTask.count({ where: { clientId: task.clientId } }),
      prisma.taskCompletion.count({ where: { task: { clientId: task.clientId } } }),
    ])
    if (total > 0 && done >= total) {
      const client = await prisma.clientProfile.findUnique({
        where: { id: task.clientId },
        select: {
          trainerId: true,
          user: { select: { name: true } },
          dog: { select: { name: true } },
          trainer: { select: { user: { select: { id: true } } } },
          assignedTrainer: { select: { user: { select: { id: true } } } },
        },
      })
      // Notify the client's assigned member (owner fallback), with prefs scoped
      // to this organisation.
      const targetUserId = client?.assignedTrainer?.user?.id ?? client?.trainer?.user?.id
      if (targetUserId && client) {
        await notifyTrainer(
          targetUserId,
          'CLIENT_COMPLETED_TASKS',
          { clientName: client.user?.name ?? 'A client', dogName: client.dog?.name ?? '', taskCount: String(total) },
          `/clients/${task.clientId}`,
          client.trainerId,
        )
      }
    }
  }

  return NextResponse.json(completion)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { taskId } = await params

  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, client: { userId: session.user.id } },
    select: { id: true },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  await prisma.taskCompletion.deleteMany({ where: { taskId } })

  return NextResponse.json({ ok: true })
}
