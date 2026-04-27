import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(2),
  description: z.string().nullable().optional(),
  repetitions: z.number().int().positive().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  dogId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const access = await getClientAccess(parsed.data.clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (!access.canEdit) return NextResponse.json({ error: 'Read-only access' }, { status: 403 })

  const baseData = {
    clientId: parsed.data.clientId,
    date: new Date(parsed.data.date),
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    repetitions: parsed.data.repetitions ?? null,
    videoUrl: parsed.data.videoUrl ?? null,
    dogId: parsed.data.dogId ?? null,
  }

  // Append to the end of the session's existing task order. Tasks not linked
  // to a session keep order=0 — they're not part of any reorderable list.
  let nextOrder = 0
  if (parsed.data.sessionId) {
    const max = await prisma.trainingTask.aggregate({
      where: { sessionId: parsed.data.sessionId },
      _max: { order: true },
    })
    nextOrder = (max._max.order ?? -1) + 1
  }

  const task = await prisma.trainingTask.create({
    data: { ...baseData, sessionId: parsed.data.sessionId ?? null, order: nextOrder },
  })

  return NextResponse.json(task, { status: 201 })
}
