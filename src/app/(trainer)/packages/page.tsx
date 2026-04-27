import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PackagesView } from './packages-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Packages' }

export default async function PackagesPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const packages = await prisma.package.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { assignments: true } } },
  })

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
        assignments: p._count.assignments,
      }))}
    />
  )
}
