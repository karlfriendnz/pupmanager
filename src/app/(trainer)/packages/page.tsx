import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PackagesView } from './packages-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Packages' }

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { connect } = await searchParams

  const [packages, trainer] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { assignments: true } } },
    }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { payoutCurrency: true } }),
  ])
  const currency = (trainer?.payoutCurrency ?? 'NZD').toUpperCase()

  return (
    <PackagesView
      initialPackages={packages.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        sessionType: p.sessionType,
        priceCents: p.priceCents,
        specialPriceCents: p.specialPriceCents,
        color: (p.color ?? null) as 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan' | null,
        defaultSessionFormId: p.defaultSessionFormId ?? null,
        requireSessionNotes: p.requireSessionNotes,
        isGroup: p.isGroup,
        capacity: p.capacity,
        allowDropIn: p.allowDropIn,
        dropInPriceCents: p.dropInPriceCents,
        allowWaitlist: p.allowWaitlist,
        publicEnrollment: p.publicEnrollment,
        clientSelfBook: p.clientSelfBook,
        selfBookRequiresApproval: p.selfBookRequiresApproval,
        requirePayment: p.requirePayment,
        assignments: p._count.assignments,
      }))}
      connectName={connect ?? null}
      currency={currency}
    />
  )
}
