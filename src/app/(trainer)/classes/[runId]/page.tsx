import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RunDetail } from './run-detail'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Class run' }

export default async function ClassRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { runId } = await params
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    include: {
      package: { select: { name: true, allowDropIn: true, allowWaitlist: true, priceCents: true, durationMins: true, sessionType: true, capacity: true, weeksBetween: true, sessionCount: true, defaultSessionFormId: true } },
      sessions: {
        orderBy: { sessionIndex: 'asc' },
        select: { id: true, title: true, scheduledAt: true, sessionIndex: true, status: true },
      },
      enrollments: {
        orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { enrolledAt: 'asc' }],
        include: {
          client: { select: { id: true, user: { select: { name: true } } } },
          dog: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!run) notFound()

  // Whether the schedule can still be edited (no attendance recorded yet).
  const attendanceCount = await prisma.sessionAttendance.count({
    where: { session: { classRunId: run.id } },
  })

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId, status: 'ACTIVE' },
    select: {
      id: true,
      user: { select: { name: true } },
      dog: { select: { id: true, name: true } },
    },
    orderBy: { user: { name: 'asc' } },
  })

  return (
    <RunDetail
      run={{
        id: run.id,
        name: run.name,
        scheduleNote: run.scheduleNote,
        startDate: run.startDate.toISOString(),
        status: run.status,
        capacity: run.capacity ?? run.package.capacity ?? null,
        packageName: run.package.name,
        allowDropIn: run.package.allowDropIn,
        allowWaitlist: run.package.allowWaitlist,
        priceCents: run.package.priceCents,
        durationMins: run.package.durationMins,
        sessionType: run.package.sessionType,
        weeksBetween: run.package.weeksBetween,
        sessionCount: run.package.sessionCount,
        defaultSessionFormId: run.package.defaultSessionFormId,
        hasAttendance: attendanceCount > 0,
      }}
      sessions={run.sessions.map(s => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        sessionIndex: s.sessionIndex,
        status: s.status,
      }))}
      enrollments={run.enrollments.map(e => ({
        id: e.id,
        status: e.status,
        type: e.type,
        waitlistPosition: e.waitlistPosition,
        source: e.source,
        clientName: e.client.user.name ?? 'Unnamed client',
        dogName: e.dog?.name ?? null,
      }))}
      clients={clients.map(c => ({
        id: c.id,
        name: c.user.name ?? 'Unnamed client',
        dogId: c.dog?.id ?? null,
        dogName: c.dog?.name ?? null,
      }))}
    />
  )
}
