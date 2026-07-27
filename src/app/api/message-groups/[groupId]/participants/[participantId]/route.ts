import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// DELETE /api/message-groups/<id>/participants/<participantId>
//
// Moderation: the trainer removes someone from a group. Their posts STAY and
// render as "Removed member" — a tombstone, not a hole. Silently deleting what
// somebody said rewrites the conversation around them, and the people who read
// it at the time would be left with a thread that no longer makes sense.
//
// optedOutAt is set alongside leftAt so an audience refresh can't quietly
// re-add them the next time the class roster is recalculated.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ groupId: string; participantId: string }> },
) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const { groupId, participantId } = await params

  // Scope through the group to the owning business first.
  const participant = await prisma.messageGroupParticipant.findFirst({
    where: { id: participantId, groupId, group: { trainerId: guard.companyId } },
    select: { id: true, role: true },
  })
  if (!participant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (participant.role !== 'CLIENT') {
    return NextResponse.json({ error: 'You can’t remove the group’s owner.' }, { status: 400 })
  }

  const now = new Date()
  await prisma.messageGroupParticipant.update({
    where: { id: participant.id },
    data: { leftAt: now, optedOutAt: now },
  })
  return NextResponse.json({ ok: true })
}
