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

  const [runs, teamMembers] = await Promise.all([
    prisma.classRun.findMany({
      where: { trainerId },
      orderBy: { startDate: 'desc' },
      include: {
        package: { select: { name: true, capacity: true } },
        _count: { select: { sessions: true } },
        enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
        assignedTrainers: {
          include: { membership: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.trainerMembership.findMany({
      where: { companyId: trainerId },
      select: { id: true, title: true, role: true, user: { select: { name: true } } },
      orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
    }),
  ])

  return (
    <ClassesView
      runs={runs.map(r => ({
        id: r.id,
        name: r.name,
        scheduleNote: r.scheduleNote,
        startDate: r.startDate.toISOString(),
        status: r.status,
        sessionCount: r._count.sessions,
        enrolledCount: r.enrollments.length,
        capacity: r.capacity ?? r.package.capacity ?? null,
        imageUrl: r.imageUrl,
        trainerNames: r.assignedTrainers.map(a => a.membership.user.name ?? 'Team member'),
      }))}
      teamMembers={teamMembers.map(m => ({
        id: m.id,
        name: m.user.name ?? 'Team member',
        title: m.title,
        isOwner: m.role === 'OWNER',
      }))}
    />
  )
}
