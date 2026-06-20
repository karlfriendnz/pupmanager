import { NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

// Hard delete a SessionAttachment row + its Blob. Same trainer-only
// permission check as the rest of the session API. Best-effort on the
// Blob side — if Vercel Blob 404s the file (already gone), we still
// want the row removed.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; attachmentId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId, attachmentId } = await params

  const att = await prisma.sessionAttachment.findFirst({
    // Scope by the parent session's accessibility too, so a restricted member
    // can't delete attachments on a session they aren't assigned to.
    where: { id: attachmentId, sessionId, trainerId, session: accessibleSessionWhere(ctx) },
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
