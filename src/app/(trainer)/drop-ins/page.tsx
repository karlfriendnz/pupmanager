import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { formatDate } from '@/lib/utils'
import { DropInsView } from './drop-ins-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Drop-ins' }

export default async function DropInsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Drop-ins ride on top of group classes — both add-ons have to be on.
  const [dropinsOn, classesOn] = await Promise.all([
    hasAddon(trainerId, 'dropins'),
    hasAddon(trainerId, 'classes'),
  ])
  if (!dropinsOn || !classesOn) redirect('/settings?tab=addons')

  const now = new Date()

  // Every class run whose package allows drop-ins. Sessions still to come are
  // what a drop-in can actually be sold into, so only those are counted.
  const runs = await prisma.classRun.findMany({
    where: {
      trainerId,
      status: { in: ['SCHEDULED', 'RUNNING'] },
      package: { allowDropIn: true },
    },
    orderBy: { startDate: 'asc' },
    include: {
      package: { select: { name: true, capacity: true, dropInPriceCents: true } },
      sessions: {
        where: { scheduledAt: { gte: now } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, sessionIndex: true },
      },
      enrollments: {
        where: { status: { in: ['ENROLLED'] } },
        select: { id: true, type: true },
      },
    },
  })

  // Recent drop-in enrolments across all runs — the "who's dropping in" view.
  const recent = await prisma.classEnrollment.findMany({
    where: { type: 'DROP_IN', classRun: { trainerId } },
    orderBy: { enrolledAt: 'desc' },
    take: 20,
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      joinedAtIndex: true,
      classRun: { select: { id: true, name: true } },
      client: { select: { id: true, user: { select: { name: true } } } },
      dog: { select: { name: true } },
    },
  })

  return (
    <DropInsView
      runs={runs.map(r => {
        const capacity = r.capacity ?? r.package.capacity ?? null
        const enrolled = r.enrollments.length
        return {
          id: r.id,
          name: r.name,
          scheduleNote: r.scheduleNote,
          startLabel: formatDate(r.startDate),
          capacity,
          enrolled,
          // A drop-in can only go into a seat that exists.
          spacesLeft: capacity == null ? null : Math.max(0, capacity - enrolled),
          dropInPriceCents: r.package.dropInPriceCents,
          dropInCount: r.enrollments.filter(e => e.type === 'DROP_IN').length,
          upcoming: r.sessions.map(s => ({
            id: s.id,
            index: s.sessionIndex,
            label: formatDate(s.scheduledAt),
          })),
        }
      })}
      recent={recent.map(e => ({
        id: e.id,
        status: e.status,
        runId: e.classRun.id,
        runName: e.classRun.name,
        clientName: e.client.user.name ?? 'Client',
        dogName: e.dog?.name ?? null,
        joinedAtIndex: e.joinedAtIndex,
        whenLabel: formatDate(e.enrolledAt),
      }))}
    />
  )
}
