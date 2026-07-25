import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionView } from './session-view'

// Shared session-detail loader. Mounted under /classes, /casual-classes and
// /doggy-daycare; `basePath` keeps "Back to class" inside the section the
// trainer came from.
export async function ClassSessionContent({
  runId,
  sessionId,
  basePath = '/classes',
}: {
  runId: string
  sessionId: string
  basePath?: string
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

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
      basePath={basePath}
    />
  )
}
