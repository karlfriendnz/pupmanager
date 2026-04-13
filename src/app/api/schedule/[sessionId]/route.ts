import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  scheduledAt: z.string(),
  durationMins: z.number().int().positive().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { sessionId } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const existing = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.trainingSession.update({
    where: { id: sessionId },
    data: {
      scheduledAt: new Date(parsed.data.scheduledAt),
      ...(parsed.data.durationMins !== undefined && { durationMins: parsed.data.durationMins }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { sessionId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, googleCalendarRefreshToken: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: trainerProfile.id },
  })
  if (!trainingSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (trainingSession.googleCalendarEventId && trainerProfile.googleCalendarRefreshToken) {
    try {
      const { deleteGoogleCalendarEvent } = await import('@/lib/google-calendar')
      await deleteGoogleCalendarEvent(trainerProfile.googleCalendarRefreshToken, trainingSession.googleCalendarEventId)
    } catch {
      // Non-critical
    }
  }

  await prisma.trainingSession.delete({ where: { id: sessionId } })
  return NextResponse.json({ ok: true })
}
