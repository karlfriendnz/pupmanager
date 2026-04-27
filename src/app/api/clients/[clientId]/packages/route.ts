import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

const schema = z.object({
  packageId: z.string().min(1),
  // Pre-resolved ISO datetimes (one per session). Computed client-side from
  // trainer availability, so order matters: index 0 = session 1, etc. We accept
  // a count <= package.sessionCount because some sessions may have been skipped
  // due to no availability — the trainer can fill those in manually.
  sessionDates: z.array(z.string().min(1)).min(1).max(52),
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

  if (parsed.data.sessionDates.length > pkg.sessionCount) {
    return NextResponse.json(
      { error: `Too many sessions: package allows ${pkg.sessionCount}` },
      { status: 400 }
    )
  }

  const sessionDates = parsed.data.sessionDates.map(s => new Date(s))
  if (sessionDates.some(d => Number.isNaN(d.getTime()))) {
    return NextResponse.json({ error: 'Invalid session date in list' }, { status: 400 })
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
      },
    })
    await tx.trainingSession.createMany({
      data: sessionDates.map((d, i) => ({
        trainerId,
        clientId,
        clientPackageId: assignment.id,
        title: `${pkg.name} — session ${i + 1}/${pkg.sessionCount}`,
        scheduledAt: d,
        durationMins: pkg.durationMins,
        sessionType: pkg.sessionType,
      })),
    })
    return assignment
  })

  return NextResponse.json(
    { ok: true, assignmentId: created.id, count: sessionDates.length },
    { status: 201 }
  )
}
