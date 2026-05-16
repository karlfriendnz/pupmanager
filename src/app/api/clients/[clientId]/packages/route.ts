import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { safeEvaluate } from '@/lib/achievements'
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

  return NextResponse.json(
    { ok: true, assignmentId: created.id, count: sessionDates.length },
    { status: 201 }
  )
}
