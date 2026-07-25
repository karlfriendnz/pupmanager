import type { Metadata } from 'next'
import { ClassRunDetailContent } from '../../classes/[runId]/run-detail-content'

export const metadata: Metadata = { title: 'Doggy daycare' }

// A doggy-daycare day-part run is a ClassRun under the hood, so it reuses the
// same detail screen — but under /doggy-daycare so the nav highlights Doggy
// Daycare and the page never touches the group-classes route or its add-on.
export default async function DaycareRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return <ClassRunDetailContent runId={runId} basePath="/doggy-daycare" backLabel="Doggy Daycare" />
}
