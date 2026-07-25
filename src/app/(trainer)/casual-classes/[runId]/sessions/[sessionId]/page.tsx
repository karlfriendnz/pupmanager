import type { Metadata } from 'next'
import { ClassSessionContent } from '../../../../classes/[runId]/sessions/[sessionId]/session-content'

export const metadata: Metadata = { title: 'Casual class session' }

export default async function CasualClassSessionPage({
  params,
}: {
  params: Promise<{ runId: string; sessionId: string }>
}) {
  const { runId, sessionId } = await params
  return <ClassSessionContent runId={runId} sessionId={sessionId} basePath="/casual-classes" />
}
