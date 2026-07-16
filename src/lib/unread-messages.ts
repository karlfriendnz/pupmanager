import { prisma } from './prisma'

// One place that counts a user's unread TRAINER_CLIENT messages, so the nav
// badge (trainer + client layouts), the live poll route, and any future caller
// all agree on the definition + the tenant scoping.

export type UnreadMessageScope =
  // Trainer: every thread in their company (clientProfile.trainerId = companyId).
  | { kind: 'trainer'; companyId: string; userId: string }
  // Client: a single client-profile thread (their active trainer relationship).
  | { kind: 'client'; clientId: string; userId: string }

/**
 * Count the messages a user hasn't read yet: TRAINER_CLIENT messages with
 * `readAt` null that they did NOT send (`senderId != userId`, so a user's own
 * sends never count), scoped to threads they're allowed to see. Read-state is a
 * single `readAt` on each row, so this mirrors exactly what GET /api/messages
 * marks read.
 */
export function countUnreadMessages(scope: UnreadMessageScope): Promise<number> {
  const thread =
    scope.kind === 'trainer'
      ? { client: { is: { trainerId: scope.companyId } } }
      : { clientId: scope.clientId }

  return prisma.message.count({
    where: {
      channel: 'TRAINER_CLIENT',
      readAt: null,
      senderId: { not: scope.userId },
      ...thread,
    },
  })
}

/**
 * A user's total unread across EVERY hat they wear — the number for their
 * native app-icon badge. A device belongs to one user, not one role, so this
 * sums unread across all companies they're a member of (owner or staff) AND all
 * client profiles they own. Same definition as countUnreadMessages (unread
 * TRAINER_CLIENT messages they didn't send), just not scoped to one active
 * context. Used by sendPush() to stamp aps.badge / the FCM count on every push.
 *
 * Returns 0 for a user with no threads at all (the icon badge should be blank).
 */
export async function unreadBadgeCountForUser(userId: string): Promise<number> {
  const [memberships, clientProfiles] = await Promise.all([
    prisma.trainerMembership.findMany({ where: { userId }, select: { companyId: true } }),
    prisma.clientProfile.findMany({ where: { userId }, select: { id: true } }),
  ])
  const companyIds = memberships.map(m => m.companyId)
  const clientIds = clientProfiles.map(c => c.id)
  if (companyIds.length === 0 && clientIds.length === 0) return 0

  const threadOr = []
  if (companyIds.length) threadOr.push({ client: { is: { trainerId: { in: companyIds } } } })
  if (clientIds.length) threadOr.push({ clientId: { in: clientIds } })

  return prisma.message.count({
    where: {
      channel: 'TRAINER_CLIENT',
      readAt: null,
      senderId: { not: userId },
      OR: threadOr,
    },
  })
}
