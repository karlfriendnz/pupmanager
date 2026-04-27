import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  // Allow 0 here since the trainer might intentionally clear reps to "0".
  // The original POST validates positive, but PATCH-after-the-fact is laxer.
  repetitions: z.number().int().min(0).nullable().optional(),
  videoUrl: z.string().url().nullable().optional().or(z.literal('')),
  dogId: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  trainerNote: z.string().nullable().optional(),
  imageUrls: z.array(z.string().url()).optional(),
})

async function resolveAccess(taskId: string, userId: string) {
  const task = await prisma.trainingTask.findUnique({
    where: { id: taskId },
    select: { clientId: true },
  })
  if (!task) return { task: null, access: null }
  const access = await getClientAccess(task.clientId, userId)
  return { task, access }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { taskId } = await params
  const { task, access } = await resolveAccess(taskId, session.user.id)
  if (!task || !access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.trainingTask.update({
    where: { id: taskId },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.repetitions !== undefined && { repetitions: parsed.data.repetitions }),
      ...(parsed.data.videoUrl !== undefined && { videoUrl: parsed.data.videoUrl || null }),
      ...(parsed.data.dogId !== undefined && { dogId: parsed.data.dogId }),
      ...(parsed.data.date !== undefined && { date: new Date(parsed.data.date) }),
      ...(parsed.data.trainerNote !== undefined && { trainerNote: parsed.data.trainerNote }),
      ...(parsed.data.imageUrls !== undefined && { imageUrls: parsed.data.imageUrls }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { taskId } = await params
  const { task, access } = await resolveAccess(taskId, session.user.id)
  if (!task || !access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  await prisma.trainingTask.delete({ where: { id: taskId } })
  return NextResponse.json({ ok: true })
}
