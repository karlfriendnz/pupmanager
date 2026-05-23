import { prisma } from './prisma'

// How far ahead the calendar should always have sessions for a forever-
// ongoing package assignment. When the latest session falls before this
// horizon, we generate more on the package's cadence until we reach it.
const EXTEND_WEEKS_AHEAD = 6
// Cap per call so a runaway never explodes session counts.
const MAX_SESSIONS_PER_EXTEND = 12

/**
 * Tops up forever-ongoing package assignments with new TrainingSessions
 * so the calendar always shows ~6 weeks of upcoming bookings without the
 * trainer manually re-assigning.
 *
 * Idempotent and best-effort — safe to call from any read path that wants
 * the calendar to stay current. Skips assignments without a clientId or
 * without any prior session to seed cadence from.
 */
export async function extendOngoingPackages(trainerId: string): Promise<void> {
  const now = new Date()
  const target = new Date()
  target.setDate(target.getDate() + EXTEND_WEEKS_AHEAD * 7)

  const ongoing = await prisma.clientPackage.findMany({
    where: {
      extendIndefinitely: true,
      package: { trainerId },
    },
    include: {
      package: { select: { weeksBetween: true, durationMins: true, sessionType: true, name: true } },
      sessions: {
        orderBy: { scheduledAt: 'desc' },
        take: 1,
        select: { id: true, scheduledAt: true, dogId: true, clientId: true, assignedMembershipId: true },
      },
    },
  })

  for (const a of ongoing) {
    const last = a.sessions[0]
    if (!last || !last.clientId) continue
    if (last.scheduledAt >= target) continue
    const cadenceWeeks = Math.max(1, a.package.weeksBetween)

    const newRows: {
      trainerId: string
      clientId: string
      dogId: string | null
      assignedMembershipId: string | null
      clientPackageId: string
      title: string
      scheduledAt: Date
      durationMins: number
      sessionType: typeof a.package.sessionType
    }[] = []

    let cursor = new Date(last.scheduledAt)
    while (cursor < target && newRows.length < MAX_SESSIONS_PER_EXTEND) {
      const next = new Date(cursor)
      next.setDate(next.getDate() + cadenceWeeks * 7)
      if (next < now) {
        // Skip past sessions — only fill forward.
        cursor = next
        continue
      }
      newRows.push({
        trainerId,
        clientId: last.clientId,
        dogId: last.dogId,
        assignedMembershipId: last.assignedMembershipId,
        clientPackageId: a.id,
        title: `${a.package.name} — session`,
        scheduledAt: next,
        durationMins: a.package.durationMins,
        sessionType: a.package.sessionType,
      })
      cursor = next
    }

    if (newRows.length > 0) {
      await prisma.trainingSession.createMany({ data: newRows })
    }
  }
}
