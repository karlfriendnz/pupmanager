import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { z } from 'zod'

const patchSchema = z.object({
  scheduledAt: z.string().optional(),
  durationMins: z.number().int().positive().optional(),
  status: z.enum(['UPCOMING', 'COMPLETED', 'COMMENTED', 'INVOICED']).optional(),
  // Toggle the invoiced flag on the session — true stamps invoicedAt = now,
  // false clears it. Independent of status so the trainer can invoice
  // before or after marking complete.
  invoiced: z.boolean().optional(),
  // null clears the dog. Empty string treated the same. Validated against the
  // session's client below (must be a dog owned by that client).
  dogId: z.string().nullable().optional(),
  // null detaches from any package. A non-null value reassigns the session
  // to another ClientPackage owned by this trainer (validated below).
  clientPackageId: z.string().nullable().optional(),
})

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    include: {
      tasks: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, description: true, repetitions: true,
          videoUrl: true, dogId: true, trainerNote: true, order: true,
          imageUrls: true,
        },
      },
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      dog: { select: { name: true } },
    },
  })

  if (!trainingSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    ...trainingSession,
    scheduledAt: trainingSession.scheduledAt.toISOString(),
  })
}

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

  // If dogId is being set (not null/empty), confirm it belongs to the session's
  // client. Without a client there's no household to attach a dog to.
  let nextDogId: string | null | undefined = undefined
  if ('dogId' in parsed.data) {
    const raw = parsed.data.dogId
    if (raw === null || raw === '') {
      nextDogId = null
    } else {
      if (!existing.clientId) {
        return NextResponse.json({ error: 'Session has no client to attach a dog to' }, { status: 400 })
      }
      const dog = await prisma.dog.findFirst({
        where: {
          id: raw,
          OR: [
            { primaryFor: { some: { id: existing.clientId } } },
            { clientProfileId: existing.clientId },
          ],
        },
        select: { id: true },
      })
      if (!dog) return NextResponse.json({ error: 'Dog not found for this client' }, { status: 400 })
      nextDogId = dog.id
    }
  }

  // Validate the new package assignment (if changing). It must belong to
  // a client owned by this trainer.
  let nextClientPackageId: string | null | undefined = undefined
  if ('clientPackageId' in parsed.data) {
    const raw = parsed.data.clientPackageId
    if (raw === null || raw === '') {
      nextClientPackageId = null
    } else {
      const cp = await prisma.clientPackage.findFirst({
        where: { id: raw, package: { trainerId } },
        select: { id: true, clientId: true, package: { select: { color: true } } },
      })
      if (!cp) return NextResponse.json({ error: 'Package assignment not found' }, { status: 400 })
      // The assignment must belong to this session's client (or the session
      // has no client yet, in which case the assignment defines the client).
      if (existing.clientId && cp.clientId !== existing.clientId) {
        return NextResponse.json({ error: 'Assignment is for a different client' }, { status: 400 })
      }
      nextClientPackageId = cp.id
    }
  }

  // ?scope=following propagates the patch to this session and every later
  // session in the same package assignment. For scheduledAt we apply a
  // delta (so each subsequent session keeps its own day, just shifted by
  // the same amount of time as this one moved).
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const propagate = scope === 'following' && existing.clientPackageId

  const updated = await prisma.trainingSession.update({
    where: { id: sessionId },
    data: {
      ...(parsed.data.scheduledAt !== undefined && { scheduledAt: new Date(parsed.data.scheduledAt) }),
      ...(parsed.data.durationMins !== undefined && { durationMins: parsed.data.durationMins }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.invoiced !== undefined && { invoicedAt: parsed.data.invoiced ? new Date() : null }),
      ...(nextDogId !== undefined && { dogId: nextDogId }),
      ...(nextClientPackageId !== undefined && { clientPackageId: nextClientPackageId }),
    },
  })

  if (propagate) {
    const followers = await prisma.trainingSession.findMany({
      where: {
        trainerId,
        clientPackageId: existing.clientPackageId,
        scheduledAt: { gt: existing.scheduledAt },
      },
      select: { id: true, scheduledAt: true },
    })
    const deltaMs = parsed.data.scheduledAt
      ? new Date(parsed.data.scheduledAt).getTime() - existing.scheduledAt.getTime()
      : 0
    await Promise.all(followers.map(f =>
      prisma.trainingSession.update({
        where: { id: f.id },
        data: {
          ...(deltaMs !== 0 && { scheduledAt: new Date(f.scheduledAt.getTime() + deltaMs) }),
          ...(parsed.data.durationMins !== undefined && { durationMins: parsed.data.durationMins }),
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(nextDogId !== undefined && { dogId: nextDogId }),
        },
      })
    ))
  }

  // Re-evaluate achievements when the status changes — completion is a counter
  // input. Resolve the session's clientId (direct or via dog's primary owner).
  if (parsed.data.status !== undefined) {
    const ctx = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: { clientId: true, dog: { select: { primaryFor: { take: 1, select: { id: true } } } } },
    })
    const cid = ctx?.clientId ?? ctx?.dog?.primaryFor[0]?.id ?? null
    await safeEvaluate(cid)
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  req: Request,
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

  // ?scope=following also deletes every later session in the same package.
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const propagate = scope === 'following' && trainingSession.clientPackageId

  let followers: { id: string; googleCalendarEventId: string | null }[] = []
  if (propagate) {
    followers = await prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        clientPackageId: trainingSession.clientPackageId,
        scheduledAt: { gt: trainingSession.scheduledAt },
      },
      select: { id: true, googleCalendarEventId: true },
    })
  }

  // Best-effort calendar cleanup — non-critical.
  if (trainerProfile.googleCalendarRefreshToken) {
    const eventIds = [
      ...(trainingSession.googleCalendarEventId ? [trainingSession.googleCalendarEventId] : []),
      ...followers.map(f => f.googleCalendarEventId).filter((id): id is string => !!id),
    ]
    if (eventIds.length > 0) {
      try {
        const { deleteGoogleCalendarEvent } = await import('@/lib/google-calendar')
        await Promise.all(eventIds.map(id => deleteGoogleCalendarEvent(trainerProfile.googleCalendarRefreshToken!, id)))
      } catch {
        // Non-critical
      }
    }
  }

  const idsToDelete = [sessionId, ...followers.map(f => f.id)]
  await prisma.trainingSession.deleteMany({ where: { id: { in: idsToDelete } } })
  return NextResponse.json({ ok: true, deletedIds: idsToDelete })
}
