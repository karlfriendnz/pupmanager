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
  if (!trainerId) redirect('/login')

  const [packages, sessionForms] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { assignments: true } } },
    }),
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
  ])

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
        assignments: p._count.assignments,
      }))}
      sessionForms={sessionForms}
    />
  )
}
