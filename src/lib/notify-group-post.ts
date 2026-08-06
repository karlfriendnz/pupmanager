// Telling people a group has a new post.
//
// PUSH ONLY (Karl, 2026-07-27). No email of any kind — not immediately, not
// deferred. The email channel for reaching many people at once belongs to
// Marketing, and a group post is not a marketing email. `marketingEmailOptOut`
// is therefore moot and deliberately not consulted.
//
// Push is best-effort and never blocks a post: one person's dead device token
// must not stop the other 299 being told the class is off. The GroupMessage
// row is the source of truth; the push is only the nudge.

import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { notifyTrainer } from '@/lib/trainer-notify'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import { chunk } from '@/lib/message-groups'
import { messagePreview } from '@/lib/message-preview'
import type { GroupMessageVisibility } from '@/generated/prisma'

interface Args {
  groupId: string
  messageId: string
  senderId: string
  body: string
  visibility: GroupMessageVisibility
  isTrainerSide: boolean
  /** Photos posted with it — a photo-only post has an empty body, and a push
   *  with no text reads as a broken app. */
  attachmentCount?: number
}

export async function notifyGroupPost(args: Args): Promise<void> {
  try {
    await run(args)
  } catch (err) {
    console.error('[notify-group-post] failed:', err instanceof Error ? err.message : 'unknown')
  }
}

async function run({ groupId, senderId, body, visibility, isTrainerSide, attachmentCount }: Args) {
  const group = await prisma.messageGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, trainerId: true, important: true },
  })
  if (!group) return

  const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { name: true } })
  const senderName = sender?.name?.split(/\s+/)[0] ?? 'Someone'
  const preview = messagePreview({ body, attachmentCount })

  // A TRAINER_ONLY post is a client's private reply in a BROADCAST group —
  // it goes to the business, not to the other members.
  if (visibility === 'TRAINER_ONLY' || !isTrainerSide) {
    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: group.trainerId },
      select: { userId: true },
    })
    if (!trainer) return
    await notifyTrainer(
      trainer.userId,
      'NEW_MESSAGE',
      { senderName, clientName: senderName, preview },
      `/messages?group=${groupId}`,
      group.trainerId,
    ).catch(err => console.error('[notify-group-post] trainer notify failed', err))
    return
  }

  // A trainer/staff post: everyone who has actually JOINED and not left.
  // Someone still sitting on a COMMUNITY invitation is not notified of posts
  // in a conversation they have not agreed to be part of.
  const recipients = await prisma.messageGroupParticipant.findMany({
    where: {
      groupId,
      role: 'CLIENT',
      leftAt: null,
      joinedAt: { not: null },
      userId: { not: senderId },
      // A muted group stays silent unless the trainer marked it Important —
      // the same override rule comms flows already use.
      ...(group.important ? {} : { mutedAt: null }),
    },
    select: { userId: true },
  })
  if (recipients.length === 0) return

  const allowed = await pushAllowed(recipients.map(r => r.userId), group.important)

  for (const part of chunk(recipients)) {
    await Promise.all(part.map(async r => {
      if (!allowed.has(r.userId)) return
      try {
        await notifyClient({
          userId: r.userId,
          trainerId: group.trainerId,
          type: 'CLIENT_NEW_MESSAGE',
          vars: { senderName: `${senderName} · ${group.name}`, preview },
          link: `/my-messages?group=${groupId}`,
          ctaLabel: 'Open messages',
          // PUSH only: no EMAIL (see the file header) and no IN_APP feed row —
          // the post is already in their messages, and a duplicate row in the
          // notifications feed is exactly what migration
          // 20260726120500_comms_flow_in_app_staff_only removed elsewhere.
          channels: ['PUSH'],
        })
      } catch (err) {
        console.error('[notify-group-post] push failed', { groupId, userId: r.userId, err })
      }
    }))
  }
}

/**
 * Which of these users should actually get a push.
 *
 * Passing `channels` to notifyClient overrides the stored preference outright,
 * so the preference has to be honoured HERE — otherwise "push only" would
 * quietly become "push, whether you asked for it or not". An Important group
 * skips the check, which is the documented override.
 */
async function pushAllowed(userIds: string[], important: boolean): Promise<Set<string>> {
  if (important) return new Set(userIds)
  const meta = NOTIFICATION_TYPES.CLIENT_NEW_MESSAGE
  const onByDefault = (meta.defaultChannels ?? meta.channels).includes('PUSH')
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type: 'CLIENT_NEW_MESSAGE', channel: 'PUSH' },
    select: { userId: true, enabled: true },
  })
  const explicit = new Map(rows.map(r => [r.userId, r.enabled]))
  return new Set(userIds.filter(id => explicit.get(id) ?? onByDefault))
}
