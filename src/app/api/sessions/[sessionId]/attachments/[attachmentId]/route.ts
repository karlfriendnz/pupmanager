import { NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Hard delete a SessionAttachment row + its Blob. Same trainer-only
// permission check as the rest of the session API. Best-effort on the
// Blob side — if Vercel Blob 404s the file (already gone), we still
// want the row removed.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; attachmentId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { sessionId, attachmentId } = await params

  const att = await prisma.sessionAttachment.findFirst({
    where: { id: attachmentId, sessionId, trainerId },
    select: { id: true, url: true },
  })
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await del(att.url)
  } catch (err) {
    console.warn('[session attachments delete] blob del failed (continuing):', err)
  }
  await prisma.sessionAttachment.delete({ where: { id: att.id } })
  return NextResponse.json({ ok: true })
}
