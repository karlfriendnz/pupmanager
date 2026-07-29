import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PackageDetail } from './package-detail'
import { seriesProgress } from '@/lib/series'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '1:1 Session' }

export default async function PackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { packageId } = await params

  const pkg = await prisma.package.findFirst({
    where: { id: packageId, trainerId },
    include: {
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: {
          client: {
            select: {
              id: true,
              status: true,
              user: { select: { name: true } },
              dog: { select: { name: true, photoUrl: true } },
              dogs: { select: { name: true, photoUrl: true }, orderBy: { createdAt: 'asc' }, take: 1 },
            },
          },
          // Calendar order, because that is what "where are they up to" means:
          // the step they're on is the one their next unfinished session
          // covers, and on a series that is NOT the same as how many they've
          // had (a skipped step makes those two numbers differ).
          sessions: {
            orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, status: true, scheduledAt: true, sessionPlanId: true },
          },
        },
      },
      // The curriculum, when this consult runs one.
      sessionPlans: {
        orderBy: { sessionIndex: 'asc' },
        select: { id: true, sessionIndex: true, title: true },
      },
    },
  })

  if (!pkg) notFound()

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { payoutCurrency: true },
  })
  const currency = profile?.payoutCurrency ?? 'nzd'

  const clients = pkg.assignments.map(a => {
    const dog = a.client.dog ?? a.client.dogs[0] ?? null
    const sessionsUsed = a.sessions.filter(s => s.status !== 'UPCOMING').length
    // A CONSULT series has no cohort — every client is at their own point in
    // the curriculum, and each may have skipped a different step — so "where
    // are they up to" is answered per assignment, from their own sessions.
    // Resolved through lib/series.ts so it agrees with the session screen.
    const progress = pkg.isSeries
      ? seriesProgress(
          pkg.sessionPlans,
          a.sessions.map(s => ({
            id: s.id,
            sessionPlanId: s.sessionPlanId,
            done: s.status !== 'UPCOMING',
            at: s.scheduledAt,
          })),
        )
      : null
    return {
      id: a.id,
      clientId: a.client.id,
      clientName: a.client.user.name ?? 'Unnamed client',
      dogName: dog?.name ?? null,
      dogPhotoUrl: dog?.photoUrl ?? null,
      clientStatus: (a.client.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      startDate: a.startDate.toISOString(),
      sessionsUsed,
      sessionsTotal: pkg.sessionCount,
      ongoing: pkg.sessionCount === 0 || a.extendIndefinitely,
      stepIndex: progress?.step?.sessionIndex ?? null,
      stepTitle: progress?.step?.title ?? null,
      stepsDone: progress?.done ?? null,
      stepsTotal: progress?.total ?? null,
      nextSessionAt: progress?.nextAt?.toISOString() ?? null,
    }
  })

  return (
    <PackageDetail
      pkg={{
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        imageUrl: pkg.imageUrl,
        priceCents: pkg.priceCents,
        specialPriceCents: pkg.specialPriceCents,
        sessionCount: pkg.sessionCount,
        weeksBetween: pkg.weeksBetween,
        durationMins: pkg.durationMins,
        bufferMins: pkg.bufferMins,
        sessionType: pkg.sessionType,
        isGroup: pkg.isGroup,
        requireSessionNotes: pkg.requireSessionNotes,
        allowDropIn: pkg.allowDropIn,
        dropInPriceCents: pkg.dropInPriceCents,
        allowWaitlist: pkg.allowWaitlist,
        capacity: pkg.capacity,
        publicEnrollment: pkg.publicEnrollment,
        clientSelfBook: pkg.clientSelfBook,
        isSeries: pkg.isSeries,
        steps: pkg.sessionPlans,
      }}
      clients={clients}
      currency={currency}
    />
  )
}
