import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { isOneOffEventPackage } from '@/lib/class-runs'
import { ClassRunDetailContent } from './run-detail-content'

export const metadata: Metadata = { title: 'Class run' }

export default async function ClassRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params

  // Events used to live at this URL — they're ClassRuns underneath, so they
  // rendered on the Group Classes screen and lit up the Group Classes tab for
  // something that isn't a class. They have their own screen now, but the old
  // path is baked into sent emails, push deep links (self-enrol, payment
  // received, staff comms flows) and the Back link off the offering editor, so
  // it redirects rather than breaks. No auth check needed to decide the route:
  // the destination gates on the trainer's own scope and the events add-on.
  const run = await prisma.classRun.findUnique({
    where: { id: runId },
    select: { package: { select: { isGroup: true, allowDropIn: true, sessionCount: true, recurrenceRule: true } } },
  })
  if (run?.package && isOneOffEventPackage(run.package)) redirect(`/events/${runId}`)

  return <ClassRunDetailContent runId={runId} basePath="/classes" backLabel="Classes" />
}
