import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  themeId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  repetitions: z.number().int().positive().optional().nullable(),
  videoUrl: z.string().url().optional().nullable().or(z.literal('')),
})

export async function POST(req: Request) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Verify the theme belongs to this trainer
  const theme = await prisma.libraryTheme.findFirst({
    where: { id: parsed.data.themeId, type: { trainerId: trainer.id } },
  })
  if (!theme) return NextResponse.json({ error: 'Theme not found' }, { status: 404 })

  const maxOrder = await prisma.libraryTask.aggregate({ where: { themeId: theme.id }, _max: { order: true } })
  const task = await prisma.libraryTask.create({
    data: {
      themeId: theme.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      repetitions: parsed.data.repetitions ?? null,
      videoUrl: parsed.data.videoUrl || null,
      order: (maxOrder._max.order ?? -1) + 1,
    },
  })

  return NextResponse.json(task, { status: 201 })
}
