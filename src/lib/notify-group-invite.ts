// Telling somebody they have been invited to a COMMUNITY group.
//
// Without this the mode is inert. A community group writes its members in with
// `joinedAt: null` — invited, not joined — and notifyGroupPost deliberately
// skips anyone who hasn't accepted, because they haven't agreed to be in a
// conversation where the other members can see them. Both halves are right.
// Together, and with nothing sending the invitation, the group is born dead:
// the trainer creates it, posts, and every single member is silently excluded
// with no way to ever find out the group exists.
//
// PUSH only, same as a post (see notify-group-post.ts) — the email channel for
// reaching many people belongs to Marketing.
//
// Deliberately NOT gated on the Important override the way posts are. An
// invitation is asked once and is the only route into the group; a muted
// preference should quieten the conversation, not hide the door to it. It is
// still gated on the client's push preference, because an invitation somebody
// has said they don't want is still something they don't want.

import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import { chunk } from '@/lib/message-groups'

interface Args {
  groupId: string
  /** Who to invite. Omit to invite everyone in the group still sitting on one. */
  userIds?: string[]
}

export async function notifyGroupInvite(args: Args): Promise<void> {
  try {
    await run(args)
  } catch (err) {
    console.error('[notify-group-invite] failed:', err instanceof Error ? err.message : 'unknown')
  }
}

async function run({ groupId, userIds }: Args) {
  const group = await prisma.messageGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, mode: true, trainerId: true, archivedAt: true },
  })
  // BROADCAST members are in from the start, so there is nothing to accept.
  if (!group || group.mode !== 'COMMUNITY' || group.archivedAt) return

  const business = await prisma.trainerProfile.findUnique({
    where: { id: group.trainerId },
    select: { businessName: true },
  })

  const pending = await prisma.messageGroupParticipant.findMany({
    where: {
      groupId,
      role: 'CLIENT',
      joinedAt: null,
      leftAt: null,
      optedOutAt: null,
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
    select: { userId: true },
  })
  if (pending.length === 0) return

  const allowed = await pushAllowed(pending.map(p => p.userId))
  const from = business?.businessName ?? 'Your trainer'

  for (const part of chunk(pending)) {
    await Promise.all(part.map(async p => {
      if (!allowed.has(p.userId)) return
      try {
        await notifyClient({
          userId: p.userId,
          trainerId: group.trainerId,
          type: 'CLIENT_NEW_MESSAGE',
          vars: {
            senderName: from,
            preview: `invited you to join “${group.name}”. Other members will see your name if you accept.`,
          },
          link: `/my-messages?group=${groupId}`,
          ctaLabel: 'See the invitation',
          channels: ['PUSH'],
        })
      } catch (err) {
        console.error('[notify-group-invite] push failed', { groupId, userId: p.userId, err })
      }
    }))
  }
}

/**
 * Honour the stored push preference, exactly as notifyGroupPost does: passing
 * `channels` to notifyClient overrides the preference outright, so it has to be
 * checked here or "push only" quietly becomes "push regardless".
 */
async function pushAllowed(userIds: string[]): Promise<Set<string>> {
  const meta = NOTIFICATION_TYPES.CLIENT_NEW_MESSAGE
  const onByDefault = (meta.defaultChannels ?? meta.channels).includes('PUSH')
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type: 'CLIENT_NEW_MESSAGE', channel: 'PUSH' },
    select: { userId: true, enabled: true },
  })
  const explicit = new Map(rows.map(r => [r.userId, r.enabled]))
  return new Set(userIds.filter(id => explicit.get(id) ?? onByDefault))
}
