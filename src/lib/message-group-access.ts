// One place to answer "may this request touch this group, and as whom".
//
// Every group route goes through this. Two ways in, and only two:
//   • trainer side — a signed-in member of the business that owns the group,
//     holding messages.send. Always a moderator.
//   • member side — a User with a live participant row on that group.
// Anything else is a 404, not a 403: a group id from another business should
// look like it does not exist.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import type { MessageGroupMode } from '@/generated/prisma'

export interface GroupAccess {
  userId: string
  groupId: string
  trainerId: string
  mode: MessageGroupMode
  name: string
  archivedAt: Date | null
  /** Trainer or staff of the owning business — sees everything, moderates. */
  isTrainerSide: boolean
  /** The participant row, for a member. Null for trainer-side staff who were
   *  never added as a participant (they still have full access). */
  participant: {
    id: string
    role: 'OWNER' | 'STAFF' | 'CLIENT'
    displayName: string
    joinedAt: Date | null
    lastReadAt: Date | null
  } | null
}

export async function getGroupAccess(groupId: string): Promise<GroupAccess | NextResponse> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const group = await prisma.messageGroup.findUnique({
    where: { id: groupId },
    select: { id: true, trainerId: true, mode: true, name: true, archivedAt: true },
  })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const participant = await prisma.messageGroupParticipant.findUnique({
    where: { groupId_userId: { groupId, userId: session.user.id } },
    select: { id: true, role: true, displayName: true, joinedAt: true, lastReadAt: true, leftAt: true },
  })

  // Trainer side: a member of the OWNING business with permission to message.
  const ctx = await getTrainerContext()
  const isTrainerSide =
    !!ctx && ctx.companyId === group.trainerId && can('messages.send', ctx.role, ctx.permissions)

  // A participant who has left keeps nothing — not read access, not posting.
  const liveParticipant = participant && !participant.leftAt ? participant : null

  if (!isTrainerSide && !liveParticipant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return {
    userId: session.user.id,
    groupId: group.id,
    trainerId: group.trainerId,
    mode: group.mode,
    name: group.name,
    archivedAt: group.archivedAt,
    isTrainerSide,
    participant: liveParticipant
      ? {
          id: liveParticipant.id,
          role: liveParticipant.role,
          displayName: liveParticipant.displayName,
          joinedAt: liveParticipant.joinedAt,
          lastReadAt: liveParticipant.lastReadAt,
        }
      : null,
  }
}

/**
 * May this access post into the group?
 *
 * Trainer side always (unless locked). A member only once they have actually
 * JOINED — in a COMMUNITY group an invitation that hasn't been accepted is not
 * consent, and someone who hasn't consented must not be able to make
 * themselves visible to the others by posting.
 */
export function canPost(access: GroupAccess): boolean {
  if (access.archivedAt) return access.isTrainerSide ? false : false
  if (access.isTrainerSide) return true
  return !!access.participant?.joinedAt
}
