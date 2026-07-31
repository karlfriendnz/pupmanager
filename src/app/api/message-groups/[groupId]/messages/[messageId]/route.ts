import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// DELETE /api/message-groups/<id>/messages/<messageId>
//
// Moderation: remove one post. A TOMBSTONE (deletedAt), never a hard delete —
// the read paths filter it out, but the row survives so a thread can't be
// silently rewritten and a moderation decision stays auditable.
//
// This does not unsend. The push has already landed on every phone in the
// group, and the UI must say so rather than implying a recall.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; messageId: string }> },
) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const { groupId, messageId } = await params

  const message = await prisma.groupMessage.findFirst({
    where: { id: messageId, groupId, group: { trainerId: guard.companyId } },
    select: { id: true, deletedAt: true },
  })
  if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (message.deletedAt) return NextResponse.json({ ok: true })

  await prisma.groupMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
