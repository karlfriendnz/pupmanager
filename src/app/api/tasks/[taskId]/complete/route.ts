import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
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
