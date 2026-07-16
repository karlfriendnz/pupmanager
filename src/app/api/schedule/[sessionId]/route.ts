import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'
import { safeEvaluate } from '@/lib/achievements'
import { notifyClient } from '@/lib/client-notify'
import { z } from 'zod'

// Notify a client their session moved/was cancelled. Fire-and-forget.
async function notifySessionChanged(opts: {
  clientId: string; trainerId: string; dogId: string | null; title: string; at: Date; detail: (when: string) => string; link: string
}) {
  const [client, dog, trainer] = await Promise.all([
    prisma.clientProfile.findUnique({ where: { id: opts.clientId }, select: { userId: true } }),
    opts.dogId ? prisma.dog.findUnique({ where: { id: opts.dogId }, select: { name: true } }) : Promise.resolve(null),
    prisma.trainerProfile.findUnique({ where: { id: opts.trainerId }, select: { user: { select: { timezone: true } } } }),
  ])
  if (!client?.userId) return
  // The session happens in the TRAINER's locale — render its time in the
  // trainer's timezone, never the server's UTC.
  const tz = trainer?.user?.timezone ?? 'Pacific/Auckland'
  const when = opts.at.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  await notifyClient({
    userId: client.userId, trainerId: opts.trainerId, type: 'CLIENT_SESSION_CHANGED',
    vars: { dogName: dog?.name ?? 'your dog', planName: opts.title, detail: opts.detail(when) },
    link: opts.link, ctaLabel: 'View session',
  })
}

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
  // null unassigns the session's trainer. A non-null value assigns it to a
  // TrainerMembership in this business (validated below).
  assignedMembershipId: z.string().nullable().optional(),
})

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
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
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const trainerId = ctx.companyId

  const existing = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId, ...accessibleSessionWhere(ctx) },
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

  // Validate the assigned trainer (if changing). The membership must belong to
  // this business (trainerId == companyId). null/'' clears the assignment.
  let nextAssignedMembershipId: string | null | undefined = undefined
  if ('assignedMembershipId' in parsed.data) {
    const raw = parsed.data.assignedMembershipId
    if (raw === null || raw === '') {
      nextAssignedMembershipId = null
    } else {
      const member = await prisma.trainerMembership.findFirst({
        where: { id: raw, companyId: trainerId },
        select: { id: true },
      })
      if (!member) return NextResponse.json({ error: 'Trainer not found in this business' }, { status: 400 })
      nextAssignedMembershipId = member.id
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
      ...(nextAssignedMembershipId !== undefined && { assignedMembershipId: nextAssignedMembershipId }),
    },
  })

  let followerIds: string[] = []
  if (propagate) {
    const followers = await prisma.trainingSession.findMany({
      where: {
        // Exclude the session we just updated. Its scheduledAt was already
        // bumped to the new time above, so when moving forward it now
        // satisfies `scheduledAt > existing.scheduledAt` and would be caught
        // here — applying the delta a SECOND time (e.g. a +15min change shows
        // up as +30 on the edited session). Filtering by id keeps the delta
        // applied exactly once regardless of update order or shift direction.
        id: { not: sessionId },
        trainerId,
        clientPackageId: existing.clientPackageId,
        scheduledAt: { gt: existing.scheduledAt },
      },
      select: { id: true, scheduledAt: true },
    })
    followerIds = followers.map(f => f.id)
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
          ...(nextAssignedMembershipId !== undefined && { assignedMembershipId: nextAssignedMembershipId }),
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

  // Don't notify on every move — the trainer may be shuffling the calendar.
  // Instead flag the moved future sessions as "pending notify"; the trainer
  // batch-sends from the schedule banner. Covers 1:1 (activated client) and
  // class sessions (members resolved when sent).
  if (
    parsed.data.scheduledAt !== undefined &&
    (existing.clientId || existing.classRunId) &&
    updated.scheduledAt.getTime() !== existing.scheduledAt.getTime() &&
    updated.scheduledAt.getTime() > Date.now()
  ) {
    await prisma.trainingSession.updateMany({
      where: {
        id: { in: [sessionId, ...followerIds] },
        scheduledAt: { gt: new Date() },
        OR: [
          { client: { is: { user: { emailVerified: { not: null } } } } },
          { classRun: { is: { enrollments: { some: { status: 'ENROLLED', client: { is: { user: { emailVerified: { not: null } } } } } } } } },
        ],
      },
      data: { rescheduleNotifyPendingAt: new Date() },
    })
  }

  // Best-effort: push the edit to the trainer's Google Calendar (no-ops if not
  // connected). Awaited inside try/catch so it completes before the response —
  // fire-and-forget is unsafe on serverless. Never breaks the update.
  try {
    const { syncSessionToGoogle, syncSessionsToGoogle } = await import('@/lib/google-calendar-sync')
    await syncSessionToGoogle(sessionId)
    if (followerIds.length) await syncSessionsToGoogle(followerIds)
  } catch {
    // Non-critical
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: trainerProfile.id, ...accessibleSessionWhere(ctx) },
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

  // Best-effort calendar cleanup — non-critical. deleteGoogleEvents self-gates
  // on the add-on + an active connection, so this no-ops when sync is off.
  try {
    const { deleteGoogleEvents } = await import('@/lib/google-calendar-sync')
    await deleteGoogleEvents(trainerProfile.id, [
      trainingSession.googleCalendarEventId,
      ...followers.map(f => f.googleCalendarEventId),
    ], trainingSession.assignedMembershipId)
  } catch {
    // Non-critical
  }

  const idsToDelete = [sessionId, ...followers.map(f => f.id)]
  await prisma.trainingSession.deleteMany({ where: { id: { in: idsToDelete } } })

  // Tell the client when a future session is cancelled.
  if (trainingSession.clientId && trainingSession.scheduledAt.getTime() > Date.now()) {
    await notifySessionChanged({
      clientId: trainingSession.clientId, trainerId: trainerProfile.id, dogId: trainingSession.dogId, title: trainingSession.title,
      at: trainingSession.scheduledAt,
      detail: when => `Cancelled — was ${when}${propagate ? ' (and later sessions)' : ''}`,
      link: '/my-sessions',
    })
  }

  // "Delete this + following" on a forever-ongoing assignment must also stop
  // the assignment regenerating. Otherwise extendOngoingPackages() (which runs
  // on every schedule load + week fetch) immediately recreates the deleted
  // sessions with new ids — the trainer deletes, they "come back", and there
  // is no way to ever clear an ongoing package's sessions from the schedule.
  if (propagate && trainingSession.clientPackageId) {
    await prisma.clientPackage.updateMany({
      where: { id: trainingSession.clientPackageId, extendIndefinitely: true },
      data: { extendIndefinitely: false },
    })
  }

  return NextResponse.json({ ok: true, deletedIds: idsToDelete })
}
