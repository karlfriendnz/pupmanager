// What a dog owner sees when they open Messages: their one thread with the
// business they're currently looking at, plus every group that business has put
// them in.
//
// The scoping rule this file exists to enforce: one person can be a client of
// several businesses (ClientProfile is per-trainer, pinned by the
// pm-active-trainer cookie — see client-context.ts). A group belonging to
// business A must never appear while they're looking at business B, so EVERY
// query below is filtered by the active `trainerId` rather than by userId alone.
// Filtering on the participant row's userId is the obvious mistake here: it
// returns the groups of every business they've ever dealt with.
//
// Read visibility goes through visibleMessagesWhere() from message-groups.ts —
// the same predicate the REST route and the SSE stream use — so a preview or an
// unread count can never surface a post the thread itself would have withheld.

import { prisma } from './prisma'
import { visibleMessagesWhere } from './message-groups'
import { countUnreadMessages } from './unread-messages'
import type { MessageGroupMode } from '@/generated/prisma'

export interface ClientThreadRow {
  kind: 'direct' | 'group'
  /** ClientProfile id for the direct thread, MessageGroup id for a group. */
  id: string
  name: string
  /** Last thing said, as this viewer is allowed to see it. Null when there is
   *  nothing to show — including a COMMUNITY invitation they haven't accepted,
   *  where showing a preview would leak the conversation before consent. */
  preview: string | null
  lastActivity: string | null
  unread: number
  mode: MessageGroupMode | null
  /** A COMMUNITY invitation still waiting on the client's answer. */
  pendingInvite: boolean
  /** Locked by the trainer — readable, no new posts. */
  archived: boolean
}

export interface ClientThreadScope {
  /** The active ClientProfile id. */
  clientId: string
  /** The client's User id — who they are as a sender and a participant. */
  userId: string
  /** The business currently being viewed. The tenancy boundary for everything
   *  in this file. */
  trainerId: string
  /** Label for the direct thread row — the business, as the client knows it. */
  trainerName: string
}

/**
 * The live group memberships this person holds WITH the active business.
 *
 * `leftAt: null` because someone who walked out keeps nothing, and the
 * group.trainerId filter is the cross-business wall.
 */
function liveMembershipsWhere(scope: { userId: string; trainerId: string }) {
  return {
    userId: scope.userId,
    leftAt: null,
    group: { is: { trainerId: scope.trainerId } },
  }
}

/**
 * Unread group posts for one person, within one business.
 *
 * Three things it must not count, and each has bitten someone before:
 *   • their own posts — a badge that lights up when you speak is noise;
 *   • a TRAINER_ONLY post they didn't write — that is another client's private
 *     reply in a BROADCAST group, which they cannot open and must not be told
 *     exists (visibleMessagesWhere is what enforces this);
 *   • anything in a COMMUNITY group they haven't accepted — GET returns them an
 *     empty thread, so a count there would be both a lie and unclearable.
 *
 * "Unread" is the per-participant watermark: posted after their lastReadAt, or
 * everything when they have never opened the group.
 */
export async function countUnreadGroupMessages(scope: {
  userId: string
  trainerId: string
}): Promise<number> {
  const memberships = await prisma.messageGroupParticipant.findMany({
    where: { ...liveMembershipsWhere(scope), joinedAt: { not: null } },
    select: { groupId: true, lastReadAt: true },
  })
  if (memberships.length === 0) return 0

  // One count for every group rather than N: each OR arm carries that group's
  // own watermark. visibleMessagesWhere already owns an OR, so the two are
  // ANDed rather than merged — a second `OR` key would silently replace it.
  return prisma.groupMessage.count({
    where: {
      senderId: { not: scope.userId },
      AND: [
        visibleMessagesWhere({ userId: scope.userId, isTrainerSide: false }),
        {
          OR: memberships.map(m => ({
            groupId: m.groupId,
            ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
          })),
        },
      ],
    },
  })
}

/**
 * The client's total unread for the nav badge: their 1:1 thread plus their
 * groups with the SAME business.
 *
 * countUnreadMessages is left exactly as it was — the 1:1 number and its tenant
 * scoping are load-bearing for the trainer side too, so groups are added on top
 * rather than folded into it.
 */
export async function countClientUnreadTotal(scope: {
  clientId: string
  userId: string
  trainerId: string
}): Promise<number> {
  const [direct, groups] = await Promise.all([
    countUnreadMessages({ kind: 'client', clientId: scope.clientId, userId: scope.userId }),
    countUnreadGroupMessages({ userId: scope.userId, trainerId: scope.trainerId }),
  ])
  return direct + groups
}

/**
 * The same total for a caller that holds only the ClientProfile id — the nav
 * badge's poll route, which gets its context from getActiveClient().
 *
 * It exists so the polled number and the server-rendered one are produced by the
 * same code. When they were allowed to differ, the badge would render with
 * groups included and then quietly drop them thirty seconds later.
 */
export async function countClientUnreadTotalForProfile(scope: {
  clientId: string
  userId: string
}): Promise<number> {
  const profile = await prisma.clientProfile.findUnique({
    where: { id: scope.clientId },
    select: { trainerId: true },
  })
  if (!profile) return 0
  return countClientUnreadTotal({ ...scope, trainerId: profile.trainerId })
}

/**
 * Every thread this client can open with the active business, newest activity
 * first with anything unread floated to the top — the same ordering the trainer
 * side uses, so the two halves of the product behave the same way.
 */
export async function listClientMessageThreads(
  scope: ClientThreadScope,
): Promise<ClientThreadRow[]> {
  const [directLast, directUnread, memberships] = await Promise.all([
    prisma.message.findFirst({
      where: { clientId: scope.clientId, channel: 'TRAINER_CLIENT' },
      orderBy: { createdAt: 'desc' },
      select: { body: true, createdAt: true },
    }),
    countUnreadMessages({ kind: 'client', clientId: scope.clientId, userId: scope.userId }),
    prisma.messageGroupParticipant.findMany({
      where: liveMembershipsWhere(scope),
      select: {
        groupId: true,
        joinedAt: true,
        lastReadAt: true,
        group: {
          select: { id: true, name: true, mode: true, lastMessageAt: true, archivedAt: true },
        },
      },
    }),
  ])

  const joined = memberships.filter(m => m.joinedAt)

  // Previews are one query per joined group. A person is in a handful of them,
  // and the alternative — one findMany over every group ordered by date — can
  // starve a quiet group behind a chatty one unless the whole history is read.
  const previews = await Promise.all(
    joined.map(m =>
      prisma.groupMessage.findFirst({
        where: {
          groupId: m.groupId,
          ...visibleMessagesWhere({ userId: scope.userId, isTrainerSide: false }),
        },
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true },
      }),
    ),
  )
  const previewOf = new Map(joined.map((m, i) => [m.groupId, previews[i]]))

  const unreadCounts = await Promise.all(
    joined.map(m =>
      prisma.groupMessage.count({
        where: {
          groupId: m.groupId,
          senderId: { not: scope.userId },
          ...visibleMessagesWhere({ userId: scope.userId, isTrainerSide: false }),
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      }),
    ),
  )
  const unreadOf = new Map(joined.map((m, i) => [m.groupId, unreadCounts[i]]))

  const rows: ClientThreadRow[] = [
    {
      kind: 'direct',
      id: scope.clientId,
      name: scope.trainerName,
      preview: directLast?.body ?? null,
      lastActivity: directLast?.createdAt.toISOString() ?? null,
      unread: directUnread,
      mode: null,
      pendingInvite: false,
      archived: false,
    },
    ...memberships.map<ClientThreadRow>(m => {
      const pendingInvite = !m.joinedAt
      const preview = previewOf.get(m.groupId)
      return {
        kind: 'group',
        id: m.group.id,
        name: m.group.name,
        // An invitation shows no content at all. Consent comes first; a preview
        // line is still the conversation.
        preview: pendingInvite ? null : preview?.body ?? null,
        lastActivity:
          (pendingInvite ? null : preview?.createdAt.toISOString()) ??
          m.group.lastMessageAt?.toISOString() ??
          null,
        unread: pendingInvite ? 0 : unreadOf.get(m.groupId) ?? 0,
        mode: m.group.mode,
        pendingInvite,
        archived: !!m.group.archivedAt,
      }
    }),
  ]

  // Unread (and an unanswered invitation, which is also waiting on them) floats
  // above everything regardless of how stale its timestamp is. The bonus keeps
  // it one comparator instead of a second sort pass — same trick the trainer's
  // list uses.
  const sortKey = (r: ClientThreadRow) =>
    (r.lastActivity ? new Date(r.lastActivity).getTime() : 0) +
    (r.unread > 0 || r.pendingInvite ? Number.MAX_SAFE_INTEGER / 2 : 0)

  return rows.sort((a, b) => sortKey(b) - sortKey(a))
}
