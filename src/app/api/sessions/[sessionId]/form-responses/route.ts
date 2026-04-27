import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  // Verify trainer owns the session
  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Return the responses with their form questions inlined so the client can
  // render labels alongside answers without a second round-trip.
  const responses = await prisma.sessionFormResponse.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    include: {
      form: { select: { id: true, name: true, questions: true, introText: true, closingText: true } },
    },
  })
  return NextResponse.json(responses)
}
