import type { Metadata } from 'next'
import { ClassSessionContent } from './session-content'

export const metadata: Metadata = { title: 'Class session' }

export default async function ClassSessionPage({
  params,
}: {
  params: Promise<{ runId: string; sessionId: string }>
}) {
  const { runId, sessionId } = await params
  return <ClassSessionContent runId={runId} sessionId={sessionId} basePath="/classes" />
}
