import type { Metadata } from 'next'
import { ClassSessionContent } from '../../../../classes/[runId]/sessions/[sessionId]/session-content'

export const metadata: Metadata = { title: 'Doggy daycare session' }

export default async function DaycareSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string; sessionId: string }>
  searchParams: Promise<{ write?: string }>
}) {
  const { runId, sessionId } = await params
  // `?write=1` arrives from the session screen's "Start notes" — same register,
  // landing on "who am I writing up" rather than on marking who turned up.
  const write = (await searchParams).write === '1'
  return <ClassSessionContent runId={runId} sessionId={sessionId} write={write} basePath="/doggy-daycare" />
}
