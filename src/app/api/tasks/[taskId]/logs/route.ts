import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { notifyTrainer } from '@/lib/trainer-notify'
import { z } from 'zod'

// A client logs a practice record against one homework task. MANY logs can exist
// per task (unlike TaskCompletion, which is one "done this week" flag). The first
// log flips the task's completion on — so the home checkmark, achievements and
// the trainer's all-done notification keep working exactly as they do from the
// quick-toggle path (../complete/route.ts), which this deliberately mirrors.

const schema = z.object({
  note: z.string().trim().max(2000).optional(),
  repsDone: z.number().int().min(0).max(100_000).optional(),
  rating: z.number().int().min(1).max(3).optional(), // 1 tough · 2 okay · 3 great
  videoUrl: z.string().url().optional().or(z.literal('')),
  imageUrls: z.array(z.string().url()).max(12).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { taskId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  // A log with nothing in it isn't a record of anything — require at least one field.
  // A photo-only log IS a valid record, so images count here too.
  const { note, repsDone, rating, videoUrl, imageUrls } = parsed.data
  if (!note && repsDone == null && rating == null && !videoUrl && !(imageUrls && imageUrls.length > 0)) {
    return NextResponse.json({ error: 'Add a note, reps, a rating, a photo or a video.' }, { status: 400 })
  }

  // Scope: the task must belong to one of THIS user's client profiles (any
  // trainer). Ids never come from the request beyond the task id we then verify.
  // We pull the task title + the client's name/dog + trainer routing here so the
  // per-log and all-done notifications don't each need a second lookup.
  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, client: { userId: session.user.id } },
    select: {
      id: true,
      clientId: true,
      title: true,
      client: {
        select: {
          trainerId: true,
          user: { select: { name: true } },
          dog: { select: { name: true } },
          trainer: { select: { user: { select: { id: true } } } },
          assignedTrainer: { select: { user: { select: { id: true } } } },
        },
      },
    },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // Only the FIRST log can be the one that flips this task (and maybe the whole
  // list) to done — a later log must not re-notify the trainer.
  const wasComplete = !!(await prisma.taskCompletion.findUnique({ where: { taskId }, select: { taskId: true } }))

  const log = await prisma.trainingLog.create({
    data: {
      taskId,
      note: note || null,
      repsDone: repsDone ?? null,
      rating: rating ?? null,
      videoUrl: videoUrl || null,
      imageUrls: imageUrls ?? [],
    },
  })

  // Tell the client's assigned trainer about EVERY log — this is the day-to-day
  // "your client just practised" nudge (separate from the all-done milestone
  // below, which only fires when the whole list clears). Same trainer routing as
  // the all-done block: assigned member first, else the business owner.
  const targetUserId = task.client.assignedTrainer?.user?.id ?? task.client.trainer?.user?.id
  if (targetUserId) {
    await notifyTrainer(
      targetUserId,
      'CLIENT_LOGGED_TRAINING',
      {
        clientName: task.client.user?.name ?? 'A client',
        dogName: task.client.dog?.name ?? '',
        taskTitle: task.title,
      },
      `/clients/${task.clientId}`,
      task.client.trainerId,
    )
  }

  // First practice logged → mark the task done (drives the home ring, streaks and
  // achievement counters, same as ../complete). Keep any existing completion note.
  if (!wasComplete) {
    await prisma.taskCompletion.upsert({ where: { taskId }, create: { taskId }, update: {} })
  }
  await safeEvaluate(task.clientId)

  // Tell the trainer when this completion clears the client's whole task list —
  // identical to the quick-toggle path so both entry points behave the same.
  if (!wasComplete) {
    const [total, done] = await Promise.all([
      prisma.trainingTask.count({ where: { clientId: task.clientId } }),
      prisma.taskCompletion.count({ where: { task: { clientId: task.clientId } } }),
    ])
    if (total > 0 && done >= total && targetUserId) {
      await notifyTrainer(
        targetUserId,
        'CLIENT_COMPLETED_TASKS',
        {
          clientName: task.client.user?.name ?? 'A client',
          dogName: task.client.dog?.name ?? '',
          taskCount: String(total),
        },
        `/clients/${task.clientId}`,
        task.client.trainerId,
      )
    }
  }

  return NextResponse.json(log)
}
