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
 * sums across all companies they're a member of (owner or staff) AND all client
 * profiles they own. Used by sendPush() to stamp aps.badge / the FCM count on
 * every push, and by /api/notifications/badge when the app comes to the front.
 *
 * TWO things are waiting for them, and the badge is the sum:
 *
 *   • unread TRAINER_CLIENT messages they didn't send;
 *   • unread ALERTS — the notification feed behind the Alerts tab.
 *
 * The alerts half was missing. This function has counted messages alone since
 * the feature landed on 2026-07-16 under the title "native app-icon badge for
 * unread notifications" — so an unread alert put a badge on the Alerts tab
 * INSIDE the app and nothing on the icon outside it, and the icon and the app
 * have disagreed ever since.
 *
 * NEW_MESSAGE notifications are excluded from the alerts half because the
 * messages half already counts them; without that, one new message reads as 2.
 * The `type: null` arm is not optional — a bare `not` drops NULL-typed rows in
 * Prisma, which is how legacy alerts ("Payment received") once counted as zero.
 *
 * Returns 0 when nothing is waiting (the icon badge should then be blank).
 */
export async function unreadBadgeCountForUser(userId: string): Promise<number> {
  const [memberships, clientProfiles] = await Promise.all([
    prisma.trainerMembership.findMany({ where: { userId }, select: { companyId: true } }),
    prisma.clientProfile.findMany({ where: { userId }, select: { id: true } }),
  ])
  const companyIds = memberships.map(m => m.companyId)
  const clientIds = clientProfiles.map(c => c.id)

  const threadOr = []
  if (companyIds.length) threadOr.push({ client: { is: { trainerId: { in: companyIds } } } })
  if (clientIds.length) threadOr.push({ clientId: { in: clientIds } })

  const [messages, alerts] = await Promise.all([
    // No threads to be unread in — skip the query rather than send an empty OR,
    // which matches everything.
    threadOr.length === 0
      ? Promise.resolve(0)
      : prisma.message.count({
          where: {
            channel: 'TRAINER_CLIENT',
            readAt: null,
            senderId: { not: userId },
            OR: threadOr,
          },
        }),
    // Alerts hang off the USER, so they count whether or not they have a
    // company or a client profile.
    prisma.notification.count({
      where: {
        userId,
        readAt: null,
        OR: [{ type: null }, { type: { not: 'NEW_MESSAGE' } }],
      },
    }),
  ])

  return messages + alerts
}
