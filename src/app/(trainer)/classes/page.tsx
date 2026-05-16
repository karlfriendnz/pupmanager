import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClassesView } from './classes-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Classes' }

export default async function ClassesPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [groupPackages, runs] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId, isGroup: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, sessionCount: true, capacity: true },
    }),
    prisma.classRun.findMany({
      where: { trainerId },
      orderBy: { startDate: 'desc' },
      include: {
        package: { select: { name: true, capacity: true } },
        _count: { select: { sessions: true } },
        enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
      },
    }),
  ])

  return (
    <ClassesView
      groupPackages={groupPackages}
      runs={runs.map(r => ({
        id: r.id,
        name: r.name,
        scheduleNote: r.scheduleNote,
        startDate: r.startDate.toISOString(),
        status: r.status,
        sessionCount: r._count.sessions,
        enrolledCount: r.enrollments.length,
        capacity: r.capacity ?? r.package.capacity ?? null,
      }))}
    />
  )
}
