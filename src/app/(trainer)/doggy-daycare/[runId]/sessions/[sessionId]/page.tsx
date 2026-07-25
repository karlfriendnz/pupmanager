import type { Metadata } from 'next'
import { ClassSessionContent } from '../../../../classes/[runId]/sessions/[sessionId]/session-content'

export const metadata: Metadata = { title: 'Doggy daycare session' }

export default async function DaycareSessionPage({
  params,
}: {
  params: Promise<{ runId: string; sessionId: string }>
}) {
  const { runId, sessionId } = await params
  return <ClassSessionContent runId={runId} sessionId={sessionId} basePath="/doggy-daycare" />
}
