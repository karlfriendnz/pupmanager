import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// z.url() happily accepts `javascript:…`, and these values end up in href/src —
// so every link field is pinned to http(s).
const webUrl = z.string().url().refine(u => /^https?:\/\//i.test(u), 'Must be a http(s) link')

const schema = z.object({
  title: z.string().min(1),
  // Rich text (Tiptap HTML). Sanitized on the way out by <RichText />.
  description: z.string().optional().nullable(),
  repetitions: z.number().int().positive().optional().nullable(),
  videoUrl: webUrl.optional().nullable().or(z.literal('')),
  // Blob URLs written by /api/library/upload; fileName is the handout's label.
  imageUrl: webUrl.optional().nullable().or(z.literal('')),
  fileUrl: webUrl.optional().nullable().or(z.literal('')),
  fileName: z.string().max(255).optional().nullable(),
})

async function getTask(taskId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId: trainer.id } } },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { taskId } = await params
  const task = await getTask(taskId, session.user.id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.libraryTask.update({
    where: { id: taskId },
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      repetitions: parsed.data.repetitions ?? null,
      videoUrl: parsed.data.videoUrl || null,
      imageUrl: parsed.data.imageUrl || null,
      fileUrl: parsed.data.fileUrl || null,
      fileName: parsed.data.fileName || null,
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { taskId } = await params
  const task = await getTask(taskId, session.user.id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.libraryTask.delete({ where: { id: taskId } })
  return NextResponse.json({ ok: true })
}
