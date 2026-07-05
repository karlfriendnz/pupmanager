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
