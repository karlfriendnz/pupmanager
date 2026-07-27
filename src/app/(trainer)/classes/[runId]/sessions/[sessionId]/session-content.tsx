import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runSessionHref } from '@/lib/run-kind'
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
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      classRun: {
        select: {
          name: true,
          // Which section this run actually belongs to (see the redirect
          // below), and the trainer's timezone so the header renders the
          // session time where the trainer lives rather than on the server.
          package: {
            select: {
              isGroup: true, allowDropIn: true, sessionCount: true,
              recurrenceRule: true, isPuppySchool: true, isEvent: true,
            },
          },
          trainer: { select: { user: { select: { timezone: true } } } },
        },
      },
    },
  })
  if (!sess) notFound()

  // Old links (and anything that guessed) can point a casual, daycare or event
  // run at /classes/…. Send it to the section that run really belongs to, so
  // "Back to class" doesn't tip the trainer out of where they were working.
  if (sess.classRun) {
    const correct = runSessionHref(runId, sess.id, sess.classRun.package)
    if (correct !== `${basePath}/${runId}/sessions/${sess.id}`) redirect(correct)
  }

  return (
    <SessionView
      runId={runId}
      sessionId={sess.id}
      runName={sess.classRun?.name ?? 'Class'}
      sessionTitle={sess.title}
      sessionScheduledAt={sess.scheduledAt.toISOString()}
      tz={sess.classRun?.trainer?.user?.timezone ?? 'Pacific/Auckland'}
      basePath={basePath}
    />
  )
}
