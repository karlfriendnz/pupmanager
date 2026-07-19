import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PackageDetail } from './package-detail'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Package' }

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
          sessions: { select: { status: true } },
        },
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
    }
  })

  return (
    <PackageDetail
      pkg={{
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
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
      }}
      clients={clients}
      currency={currency}
    />
  )
}
