import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Lists attachments for a session. Used by the client component to
// re-sync after an upload completes (the row was inserted server-side
// inside the Blob upload's onUploadCompleted callback, so the client
// needs to fetch to learn its id and timestamps).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { sessionId } = await params

  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.sessionAttachment.findMany({
    where: { sessionId, trainerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, kind: true, url: true, thumbnailUrl: true,
      caption: true, sizeBytes: true, durationMs: true, createdAt: true,
    },
  })
  return NextResponse.json({
    attachments: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
  })
}
