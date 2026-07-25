import type { Metadata } from 'next'
import { ClassRunDetailContent } from './run-detail-content'

export const metadata: Metadata = { title: 'Class run' }

export default async function ClassRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return <ClassRunDetailContent runId={runId} basePath="/classes" backLabel="Classes" />
}
