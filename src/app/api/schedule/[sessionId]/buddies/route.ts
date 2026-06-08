import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string().min(1),
  dogId: z.string().min(1).optional().nullable(),
  // For recurring "buddies walk" series: which walks to add this dog to.
  // 'this' = only this walk; 'following' = this + later walks in the series;
  // 'series' = every walk in the series. Ignored for non-series sessions.
  scope: z.enum(['this', 'following', 'series']).default('this'),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { clientId, scope } = parsed.data

  // Trainer must own the session
  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: { id: true, clientId: true, dogId: true, walkSeriesId: true, scheduledAt: true },
  })
  if (!trainingSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Trainer must own the buddy client too
  const buddyClient = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId },
    select: { id: true },
  })
  if (!buddyClient) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // The primary attendee (same client + same dog) can't also be a buddy.
  // Same client with a different dog is fine — a household with multiple dogs.
  if (trainingSession.clientId === clientId && trainingSession.dogId === parsed.data.dogId) {
    return NextResponse.json(
      { error: 'This dog is already the primary attendee' },
      { status: 400 }
    )
  }

  // Validate dog belongs to the buddy client (if provided)
  let dogId: string | null = null
  if (parsed.data.dogId) {
    const dog = await prisma.dog.findFirst({
      where: {
        id: parsed.data.dogId,
        OR: [
          { primaryFor: { some: { id: clientId } } },
          { clientProfileId: clientId },
        ],
      },
      select: { id: true },
    })
    if (!dog) return NextResponse.json({ error: 'Dog not found for this client' }, { status: 400 })
    dogId = dog.id
  }

  // Resolve which sessions get the buddy. Only series sessions honour scope.
  let targets: { id: string; clientId: string | null; dogId: string | null }[] = [
    { id: trainingSession.id, clientId: trainingSession.clientId, dogId: trainingSession.dogId },
  ]
  if (trainingSession.walkSeriesId && scope !== 'this') {
    targets = await prisma.trainingSession.findMany({
      where: {
        trainerId,
        walkSeriesId: trainingSession.walkSeriesId,
        ...(scope === 'following' ? { scheduledAt: { gte: trainingSession.scheduledAt } } : {}),
      },
      select: { id: true, clientId: true, dogId: true },
    })
  }

  // Add to every target except where this dog is that session's primary.
  // skipDuplicates handles the unique (sessionId, clientId, dogId) gracefully.
  const rows = targets
    .filter(t => !(t.clientId === clientId && t.dogId === dogId))
    .map(t => ({ sessionId: t.id, clientId, dogId }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'This dog is already the primary attendee' }, { status: 400 })
  }

  await prisma.sessionBuddy.createMany({ data: rows, skipDuplicates: true })

  // Return the buddy row for the CURRENT session so the modal can update inline.
  const current = await prisma.sessionBuddy.findFirst({
    where: { sessionId, clientId, dogId },
    include: {
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      dog: { select: { id: true, name: true } },
    },
  })
  if (!current) {
    return NextResponse.json({ error: 'This buddy is already on this walk' }, { status: 409 })
  }
  return NextResponse.json({ ...current, affectedSessions: rows.length }, { status: 201 })
}
