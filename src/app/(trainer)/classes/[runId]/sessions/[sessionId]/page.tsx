import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionView } from './session-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Class session' }

export default async function ClassSessionPage({
  params,
}: {
  params: Promise<{ runId: string; sessionId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { runId, sessionId } = await params
  const sess = await prisma.trainingSession.findFirst({
    where: { id: sessionId, classRunId: runId, classRun: { trainerId } },
    select: { id: true, title: true, scheduledAt: true, classRun: { select: { name: true } } },
  })
  if (!sess) notFound()

  return (
    <SessionView
      runId={runId}
      sessionId={sess.id}
      runName={sess.classRun?.name ?? 'Class'}
      sessionTitle={sess.title}
      sessionScheduledAt={sess.scheduledAt.toISOString()}
    />
  )
}
