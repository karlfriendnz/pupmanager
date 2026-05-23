import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const guard = await guardPermission('clients.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { templateId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify template belongs to trainer
  const template = await prisma.trainingTemplate.findFirst({
    where: { id: templateId, trainerId: trainerProfile.id },
    include: { tasks: { orderBy: [{ dayOffset: 'asc' }, { order: 'asc' }] } },
  })
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { clientId, startDate } = parsed.data

  // Verify client belongs to this trainer
  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: trainerProfile.id },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const start = new Date(startDate)

  // Create a TrainingTask for each TemplateTask offset from the start date
  const taskData = template.tasks.map(t => {
    const date = new Date(start)
    date.setDate(date.getDate() + (t.dayOffset - 1))
    return {
      clientId,
      title: t.title,
      description: t.description,
      repetitions: t.repetitions,
      videoUrl: t.videoUrl,
      date,
    }
  })

  await prisma.trainingTask.createMany({ data: taskData })

  return NextResponse.json({ created: taskData.length })
}
