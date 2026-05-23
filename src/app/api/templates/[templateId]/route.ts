import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const taskSchema = z.object({
  dayOffset: z.coerce.number().int().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  repetitions: z.coerce.number().int().positive().optional().or(z.literal('')),
  videoUrl: z.string().url().optional().or(z.literal('')),
  order: z.number().default(0),
})

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  tasks: z.array(taskSchema).min(1),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { templateId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const template = await prisma.trainingTemplate.findFirst({
    where: { id: templateId, trainerId: trainerProfile.id },
  })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, description, tasks } = parsed.data

  // Replace all tasks atomically
  const updated = await prisma.$transaction(async tx => {
    await tx.templateTask.deleteMany({ where: { templateId } })
    return tx.trainingTemplate.update({
      where: { id: templateId },
      data: {
        name,
        description,
        tasks: {
          create: tasks.map(t => ({
            dayOffset: t.dayOffset,
            title: t.title,
            description: t.description || null,
            repetitions: t.repetitions ? Number(t.repetitions) : null,
            videoUrl: t.videoUrl && t.videoUrl !== '' ? t.videoUrl : null,
            order: t.order,
          })),
        },
      },
      include: { tasks: true },
    })
  })

  return NextResponse.json(updated)
}
