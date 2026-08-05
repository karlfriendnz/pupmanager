import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { hasAddon } from '@/lib/billing'
import { MessagesView, type ClientRow, type GroupRow } from './messages-view'
import type { AudienceOption } from './group-composer'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'
import { THREAD_PROPOSAL_SELECT, toThreadProposal } from '@/lib/thread-proposal'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; client?: string; group?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Messaging is part of the Client app add-on (default-on; blocked when off).
  if (!(await hasAddon(trainerId, 'messaging'))) redirect(addonSettingsHref('messaging'))

  const sp = await searchParams
  // 'groups' is a FILTER on the same list, not a different place: a group is a
  // thread and still belongs in Active. This is for the trainer who has a lot
  // of both and wants to see only one of them.
  const tab = sp.tab === 'inactive' ? 'inactive' : sp.tab === 'groups' ? 'groups' : 'active'
  const selectedClientId = sp.client ?? null
  // A client thread and a group are alternative right-pane contents; the
  // thread wins if both somehow end up in the URL.
  const selectedGroupId = selectedClientId ? null : sp.group ?? null

  // One query for the whole list — every client this trainer owns,
  // their last message, and a per-thread unread count. NEW (invite
  // not yet accepted) clients bucket into Active so an in-flight
  // onboarding chat doesn't get hidden.
  // Fetch the client list AND the open thread (if any) in parallel — the
  // thread only needs the clientId, so it doesn't have to wait for the list.
  const clientsP = prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true, photoUrl: true } },
      dogs: { select: { photoUrl: true } },
      messages: {
        where: { channel: 'TRAINER_CLIENT' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        // senderId + readAt drive the row's delivery status: when the last
        // word was OURS, the row says whether the client has opened it yet.
        select: { body: true, createdAt: true, senderId: true, readAt: true, sender: { select: { name: true } } },
      },
      _count: {
        select: {
          messages: {
            where: {
              channel: 'TRAINER_CLIENT',
              readAt: null,
              senderId: { not: session.user.id },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  // Trainer-scoped so a stray ?client= can't surface someone else's thread.
  const threadP = selectedClientId ? loadMessages(selectedClientId, trainerId) : Promise.resolve([])
  const groupsP = loadGroups(trainerId, session.user.id)
  const audienceP = loadAudiences(trainerId)
  const [clients, loadedThread, groups, audiences] = await Promise.all([
    clientsP, threadP, groupsP, audienceP,
  ])

  function sortKey(c: typeof clients[number]): number {
    const lastMs = c.messages[0]?.createdAt?.getTime() ?? 0
    // Anything with unread floats to the top regardless of how stale
    // its last-message timestamp is. The huge bonus is just to make
    // the comparator deterministic without a separate sort pass.
    const unreadBonus = c._count.messages > 0 ? Number.MAX_SAFE_INTEGER / 2 : 0
    return lastMs + unreadBonus
  }
  const sorted = [...clients].sort((a, b) => sortKey(b) - sortKey(a))

  function toRow(c: typeof clients[number]): ClientRow {
    const last = c.messages[0]
    return {
      id: c.id,
      status: c.status,
      displayName: c.user.name ?? c.user.email ?? 'Client',
      dogName: c.dog?.name ?? null,
      dogPhotoUrl: c.dog?.photoUrl ?? c.dogs[0]?.photoUrl ?? null,
      unread: c._count.messages,
      lastMessage: last
        ? {
            body: last.body,
            createdAt: last.createdAt.toISOString(),
            senderName: last.sender.name ?? null,
            // "Ours" = anyone on this side of the thread, not just the signed-in
            // staff member: a colleague's reply is still the business replying.
            outgoing: last.senderId !== c.userId,
            readAt: last.readAt ? last.readAt.toISOString() : null,
          }
        : null,
    }
  }

  const activeClients = sorted.filter(c => c.status === 'ACTIVE' || c.status === 'NEW').map(toRow)
  const inactiveClients = sorted.filter(c => c.status === 'INACTIVE').map(toRow)
  const activeUnread = activeClients.reduce((sum, c) => sum + c.unread, 0)
  const inactiveUnread = inactiveClients.reduce((sum, c) => sum + c.unread, 0)

  // Load the selected thread (if any). Done in this server component so
  // navigating between threads re-renders with fresh data, and so the
  // unread-clearing update below runs server-side without an extra
  // round-trip.
  let selectedClient: { id: string; displayName: string; dogName: string | null; dogPhotoUrl: string | null } | null = null
  let threadMessages: Awaited<ReturnType<typeof loadMessages>> = []
  if (selectedClientId) {
    const found = sorted.find(c => c.id === selectedClientId)
    if (found) {
      selectedClient = {
        id: found.id,
        displayName: found.user.name ?? found.user.email ?? 'Client',
        dogName: found.dog?.name ?? null,
        dogPhotoUrl: found.dog?.photoUrl ?? found.dogs[0]?.photoUrl ?? null,
      }
      threadMessages = loadedThread

      // Mark unread as read BEFORE returning. This is the "I opened this"
      // signal, and the thread nudges the nav badge to recount ~1.2s later
      // (pm:refresh-unread). Deferring the write with after() ran it AFTER the
      // response flushed, so on a slow function the recount read the still-unread
      // rows and the badge stayed lit until the next 25s poll. The client page
      // awaits the same write for exactly this reason — one indexed updateMany,
      // negligible render cost.
      const unreadIds = threadMessages
        .filter(m => m.senderId !== session.user.id)
        .map(m => m.id)
      if (unreadIds.length > 0) {
        await prisma.message.updateMany({
          where: { id: { in: unreadIds }, readAt: null },
          data: { readAt: new Date() },
        })
      }
    }
  }

  return (
    // Bounded to viewport height so the two-pane layout can scroll its
    // panes internally. The trainer-shell outer is `min-h-screen` (it
    // grows when a page is taller than the viewport), so on DESKTOP a
    // flex-1 pane wouldn't be constrained and we still measure off the
    // viewport.
    //
    // Note: no top padding — the messages surface goes flush against
    // its container so there's no dead band above PageHeader, and the
    // chrome below PageHeader (tabs + list) flows seamlessly.
    <>
      <PageHeader title="Messages" />
      {/* The pane must have a DEFINITE height — <main>'s own height is
          content-driven (its parent is min-h-screen), so a flex-1 pane
          would size to the whole message history and scroll the page
          instead of the list.
          PHONE: viewport, minus the shell's top bar (h-14 + 1px border,
          plus the inset it reserves and the capped inset <main> adds on
          top), minus the bottom tab bar (58px).
          The old `calc(100dvh-5rem-69px)` guessed both ends and got both
          wrong: 5rem for a tab bar that measures 58px, and 69px for a
          PageHeader that renders NOTHING on the trainer phone (the
          shell's top bar owns the title there). Those two errors are the
          34px band Karl saw between the composer and the tabs.
          `-mb-20` cancels <main>'s pb-20, which exists so ordinary
          scrolling pages clear the tab bar — this pane measures the bar
          itself, so counting it twice would push the page taller than
          the viewport. env(safe-area-inset-bottom) is deliberately
          absent: `html[data-native] body` already pads it once, globally.
          DESKTOP: no tab bar, so it keeps viewport-minus-header. */}
      <div className={`flex flex-col overflow-hidden px-4 md:mb-0 md:px-8 md:h-[calc(100dvh-69px)] ${
        selectedClient || selectedGroupId
          // Thread open: the shell hides BOTH its top bar and the bottom tab
          // bar (SetPageImmersive), so there is no chrome left to subtract —
          // the pane is the whole viewport. Subtracting the old 57+58 here is
          // what left ~115px of dead space under the composer. The negative
          // margin cancels <main>'s bottom padding in full, inset included.
          ? 'h-[100dvh] -mb-[calc(5rem+env(safe-area-inset-bottom,0px))]'
          // List: both bars are present, so measure them off.
          : 'h-[calc(100dvh-57px-58px-env(safe-area-inset-top,0px)-min(env(safe-area-inset-top,0px),1rem))] -mb-20'
      }`}>
        <MessagesView
          activeClients={activeClients}
          inactiveClients={inactiveClients}
          activeUnread={activeUnread}
          inactiveUnread={inactiveUnread}
          groups={groups}
          tab={tab}
          selectedClient={selectedClient}
          selectedGroupId={selectedGroupId}
          threadMessages={threadMessages}
          currentUserId={session.user.id}
          audiences={audiences}
          pickableClients={activeClients.map(c => ({
            id: c.id,
            displayName: c.displayName,
            dogName: c.dogName,
          }))}
          activeClientCount={activeClients.length}
        />
      </div>
    </>
  )
}

// The trainer's groups, for the merged list. Unread is the per-participant
// lastReadAt watermark — Message.readAt is untouched and still means exactly
// what it always did for 1:1 threads.
async function loadGroups(trainerId: string, userId: string): Promise<GroupRow[]> {
  const groups = await prisma.messageGroup.findMany({
    where: { trainerId },
    select: {
      id: true, name: true, mode: true, archivedAt: true, lastMessageAt: true, createdAt: true,
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, createdAt: true, senderId: true },
      },
      participants: {
        select: { id: true, userId: true, role: true, displayName: true, leftAt: true, joinedAt: true, lastReadAt: true },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })
  if (groups.length === 0) return []

  // One grouped count instead of a query per group.
  const mine = new Map(
    groups.map(g => [g.id, g.participants.find(p => p.userId === userId)?.lastReadAt ?? null]),
  )
  // The read watermark differs per group, so this can't be a single groupBy.
  // One indexed findMany over (groupId, createdAt) and count in memory beats N
  // round-trips, and the volume here is one row per unread post.
  const candidates = await prisma.groupMessage.findMany({
    where: {
      groupId: { in: groups.map(g => g.id) },
      deletedAt: null,
      senderId: { not: userId },
    },
    select: { groupId: true, createdAt: true },
  })
  const unread = new Map<string, number>()
  for (const m of candidates) {
    const watermark = mine.get(m.groupId)
    if (watermark && m.createdAt <= watermark) continue
    unread.set(m.groupId, (unread.get(m.groupId) ?? 0) + 1)
  }

  return groups.map(g => {
    const last = g.messages[0]
    const nameOf = new Map(g.participants.map(p => [p.userId, p.leftAt ? 'Removed member' : p.displayName]))
    return {
      id: g.id,
      name: g.name,
      mode: g.mode,
      createdAt: g.createdAt.toISOString(),
      archived: !!g.archivedAt,
      memberCount: g.participants.filter(p => p.role === 'CLIENT' && !p.leftAt && p.joinedAt).length,
      // Someone still sitting on a COMMUNITY invitation is worth surfacing —
      // a group nobody accepted looks identical to a quiet one otherwise.
      invitedCount: g.participants.filter(p => p.role === 'CLIENT' && !p.leftAt && !p.joinedAt).length,
      unread: unread.get(g.id) ?? 0,
      lastMessage: last
        ? {
            body: last.body,
            createdAt: last.createdAt.toISOString(),
            senderName: nameOf.get(last.senderId) ?? 'Removed member',
          }
        : null,
    }
  })
}

// The groups a trainer can build in one go.
async function loadAudiences(trainerId: string): Promise<{
  classRuns: AudienceOption[]
  packages: AudienceOption[]
  memberships: AudienceOption[]
}> {
  const [runs, pkgs, memberships] = await Promise.all([
    prisma.classRun.findMany({
      where: { trainerId, isSample: false, status: { in: ['SCHEDULED', 'RUNNING'] } },
      select: {
        id: true, name: true,
        _count: { select: { enrollments: { where: { status: 'ENROLLED' } } } },
      },
      orderBy: { startDate: 'desc' },
      take: 30,
    }),
    prisma.package.findMany({
      where: { trainerId, isSample: false },
      select: { id: true, name: true, _count: { select: { assignments: true } } },
      orderBy: { name: 'asc' },
      take: 30,
    }),
    prisma.membership.findMany({
      where: { trainerId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 30,
    }),
  ])

  // Membership has no back-relation to its purchases, so count actives in one
  // grouped query rather than N.
  const activeByMembership = memberships.length
    ? await prisma.membershipPurchase.groupBy({
        by: ['membershipId'],
        where: { trainerId, status: 'ACTIVE', membershipId: { in: memberships.map(m => m.id) } },
        _count: { _all: true },
      })
    : []
  const activeCount = new Map(activeByMembership.map(g => [g.membershipId, g._count._all]))

  // An empty group is noise in the picker — you can't message nobody.
  return {
    classRuns: runs.map(r => ({ id: r.id, name: r.name, count: r._count.enrollments })).filter(o => o.count > 0),
    packages: pkgs.map(p => ({ id: p.id, name: p.name, count: p._count.assignments })).filter(o => o.count > 0),
    memberships: memberships
      .map(m => ({ id: m.id, name: m.name, count: activeCount.get(m.id) ?? 0 }))
      .filter(o => o.count > 0),
  }
}

async function loadMessages(clientId: string, trainerId: string) {
  const msgs = await prisma.message.findMany({
    where: { clientId, channel: 'TRAINER_CLIENT', client: { trainerId } },
    include: {
      sender: { select: { name: true, email: true } },
      // Null on all but a counter-offer; those render as a card in the thread.
      bookingProposal: { select: THREAD_PROPOSAL_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  })
  return msgs.map(m => ({
    id: m.id,
    body: m.body,
    senderId: m.senderId,
    createdAt: m.createdAt.toISOString(),
    // Set when the OTHER party opened the thread, so on our own messages it is
    // literally "the client has read this".
    readAt: m.readAt ? m.readAt.toISOString() : null,
    sender: { name: m.sender.name, email: m.sender.email ?? '' },
    proposal: toThreadProposal(m.bookingProposal),
  }))
}
