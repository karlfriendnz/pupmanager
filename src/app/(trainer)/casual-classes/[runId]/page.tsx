import type { Metadata } from 'next'
import { ClassRunDetailContent } from '../../classes/[runId]/run-detail-content'

export const metadata: Metadata = { title: 'Casual class' }

// Casual classes are ClassRuns too, but they get their own detail route so the
// nav highlights Casual Classes (not Group Classes) and the page never depends
// on the group-classes add-on / route.
export default async function CasualClassRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return <ClassRunDetailContent runId={runId} basePath="/casual-classes" backLabel="Casual Classes" />
}
