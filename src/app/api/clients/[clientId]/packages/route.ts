import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { safeEvaluate } from '@/lib/achievements'
import { notifyClient } from '@/lib/client-notify'
import { z } from 'zod'

// Returns the client's active package assignments. Used by the session
// popup so the trainer can reassign a session to a different package.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  const assignments = await prisma.clientPackage.findMany({
    where: { clientId },
    select: {
      id: true,
      startDate: true,
      extendIndefinitely: true,
      invoicedAt: true,
      package: { select: { id: true, name: true, color: true, sessionCount: true, weeksBetween: true } },
    },
    orderBy: { assignedAt: 'desc' },
  })
  return NextResponse.json(assignments.map(a => ({
    ...a,
    startDate: a.startDate.toISOString(),
    invoicedAt: a.invoicedAt?.toISOString() ?? null,
  })))
}

const schema = z.object({
  packageId: z.string().min(1),
  // Pre-resolved ISO datetimes (one per session). Computed client-side from
  // trainer availability, so order matters: index 0 = session 1, etc. We accept
  // a count <= package.sessionCount because some sessions may have been skipped
  // due to no availability — the trainer can fill those in manually.
  sessionDates: z.array(z.string().min(1)).min(1).max(52),
  // Optional dog to attach to every created session. Must belong to the client.
  dogId: z.string().min(1).optional().nullable(),
  // True = "no end date". The schedule keeps topping the assignment up
  // with ~6 weeks of upcoming sessions on each load.
  extendIndefinitely: z.boolean().optional(),
  // Trainer ticks this when they've already sent the invoice (Xero/QBO/cash).
  // Stamps invoicedAt = now; otherwise leaves it null.
  markInvoiced: z.boolean().optional(),
  // Whether to notify the client they've been booked in. Default true; the
  // trainer can untick it (e.g. when back-filling history).
  notify: z.boolean().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access || !access.canEdit) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }
  const trainerId = access.trainerId

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const pkg = await prisma.package.findFirst({
    where: { id: parsed.data.packageId, trainerId },
  })
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  // sessionCount === 0 means the package is ongoing — any number of sessions is
  // valid (still capped at 52 by the request schema).
  if (pkg.sessionCount > 0 && parsed.data.sessionDates.length > pkg.sessionCount) {
    return NextResponse.json(
      { error: `Too many sessions: package allows ${pkg.sessionCount}` },
      { status: 400 }
    )
  }

  const sessionDates = parsed.data.sessionDates.map(s => new Date(s))
  if (sessionDates.some(d => Number.isNaN(d.getTime()))) {
    return NextResponse.json({ error: 'Invalid session date in list' }, { status: 400 })
  }

  // Validate the dog (if any) belongs to this client. A dog can be either the
  // client's primary `dog` or one of the additional `dogs` they own.
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

  // Block stacking duplicate forever-ongoing assignments — but only a true
  // duplicate: same dog, same package, on the same weekly *slot* (day-of-week
  // + time). extendOngoingPackages() tops up each ongoing assignment from its
  // own last session's day/time, so two assignments on the SAME slot generate
  // two identical series and make deletes look like they "come back". Two on
  // DIFFERENT slots (e.g. Walk & Train Mon 10am AND Thu 2:30pm for the same
  // dog) top up independently and never collide — that's a legitimate setup,
  // as is the same package for a different dog in the household.
  // Fixed-count packages can still be assigned repeatedly (legitimate
  // repurchase) — only ongoing (sessionCount 0 + extendIndefinitely) stacks.
  // dogId lives on the child sessions (not on ClientPackage), so we read each
  // ongoing assignment's anchor session to compare slots.
  if (pkg.sessionCount === 0 && parsed.data.extendIndefinitely === true) {
    // Minute-of-week (0..10079), so identical day-of-week + HH:mm collide
    // regardless of which calendar week each falls in. UTC-based — Vercel runs
    // in UTC and the top-up engine steps by whole 7-day intervals, so a weekly
    // slot maps to a stable minute-of-week. Floored to the minute to absorb
    // any sub-minute drift between stored and proposed times.
    const WEEK_MIN = 7 * 24 * 60
    const slotOf = (d: Date) => {
      const m = Math.floor(d.getTime() / 60000) % WEEK_MIN
      return m < 0 ? m + WEEK_MIN : m
    }
    const existing = await prisma.clientPackage.findMany({
      where: {
        clientId,
        packageId: pkg.id,
        extendIndefinitely: true,
        sessions: { some: { dogId } },
      },
      select: {
        // The latest session is the exact anchor extendOngoingPackages() uses
        // to project this assignment forward, so it defines the live slot.
        sessions: {
          where: { dogId },
          orderBy: { scheduledAt: 'desc' },
          take: 1,
          select: { scheduledAt: true },
        },
      },
    })
    const existingSlots = new Set(
      existing.flatMap(a => a.sessions.map(s => slotOf(s.scheduledAt))),
    )
    const collides = sessionDates.some(d => existingSlots.has(slotOf(d)))
    if (collides) {
      return NextResponse.json(
        { error: 'This dog already has an ongoing assignment of this package on that day and time. Pick a different day or time, or edit the existing one.' },
        { status: 409 },
      )
    }
  }

  // New sessions inherit the client's assigned trainer (if any), so a member's
  // bookings show up on their own calendar straight away.
  const clientRow = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { assignedMembershipId: true },
  })
  const assignedMembershipId = clientRow?.assignedMembershipId ?? null

  // The startDate field stores when the package began for this client — use the
  // first scheduled session as the canonical start.
  const startDate = sessionDates[0]

  const created = await prisma.$transaction(async (tx) => {
    const assignment = await tx.clientPackage.create({
      data: {
        packageId: pkg.id,
        clientId,
        startDate,
        extendIndefinitely: parsed.data.extendIndefinitely === true && pkg.sessionCount === 0,
        invoicedAt: parsed.data.markInvoiced ? new Date() : null,
      },
    })
    const invoicedAt = parsed.data.markInvoiced ? new Date() : null
    await tx.trainingSession.createMany({
      data: sessionDates.map((d, i) => ({
        trainerId,
        clientId,
        dogId,
        assignedMembershipId,
        clientPackageId: assignment.id,
        // Single-session packages don't need a "1/1" suffix — that's noise.
        // Multi-session keeps "N/M" so the trainer can see progression.
        title: pkg.sessionCount === 1
          ? pkg.name
          : pkg.sessionCount > 1
          ? `${pkg.name} — session ${i + 1}/${pkg.sessionCount}`
          : `${pkg.name} — session ${i + 1}`,
        scheduledAt: d,
        durationMins: pkg.durationMins,
        sessionType: pkg.sessionType,
        // If the trainer ticked "already invoiced" on the package, each
        // child session inherits invoicedAt — independent of status so
        // the trainer can still mark sessions complete after they happen.
        invoicedAt,
      })),
    })
    return assignment
  })

  // FIRST_PACKAGE_ASSIGNED trigger fires here.
  await safeEvaluate(clientId)

  // Notify the client they've been booked in — unless the trainer opted out or
  // every session is in the past (a history back-fill).
  if (parsed.data.notify !== false && sessionDates.some(d => d.getTime() > Date.now())) {
    const [clientProfile, trainer, dog] = await Promise.all([
      prisma.clientProfile.findUnique({ where: { id: clientId }, select: { userId: true, user: { select: { timezone: true } } } }),
      prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { businessName: true, user: { select: { name: true } } } }),
      dogId ? prisma.dog.findUnique({ where: { id: dogId }, select: { name: true } }) : Promise.resolve(null),
    ])
    if (clientProfile?.userId) {
      const tz = clientProfile.user?.timezone ?? 'Pacific/Auckland'
      const sorted = [...sessionDates].sort((a, b) => a.getTime() - b.getTime())
      await notifyClient({
        userId: clientProfile.userId,
        trainerId,
        type: 'CLIENT_ADDED_TO_PLAN',
        vars: {
          trainerName: trainer?.user?.name ?? trainer?.businessName ?? 'Your trainer',
          dogName: dog?.name ?? 'your dog',
          planName: pkg.name,
          detail: `${sessionDates.length} session${sessionDates.length === 1 ? '' : 's'}`,
        },
        link: '/my-sessions',
        ctaLabel: 'View your sessions',
        sessions: sorted.map(d => ({ when: d.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) })),
      })
    }
  }

  return NextResponse.json(
    { ok: true, assignmentId: created.id, count: sessionDates.length },
    { status: 201 }
  )
}
