import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { hasAddon } from '@/lib/billing'
import { MessagesView, type ClientRow } from './messages-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; client?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Messaging is part of the Client app add-on (default-on; blocked when off).
  if (!(await hasAddon(trainerId, 'clientapp'))) redirect('/settings?tab=addons')

  const sp = await searchParams
  const tab = sp.tab === 'inactive' ? 'inactive' : 'active'
  const selectedClientId = sp.client ?? null

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
  const [clients, loadedThread] = await Promise.all([clientsP, threadP])

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
      <div className="flex flex-col overflow-hidden px-4 -mb-20 h-[calc(100dvh-57px-58px-env(safe-area-inset-top,0px)-min(env(safe-area-inset-top,0px),1rem))] md:mb-0 md:px-8 md:h-[calc(100dvh-69px)]">
        <MessagesView
          activeClients={activeClients}
          inactiveClients={inactiveClients}
          activeUnread={activeUnread}
          inactiveUnread={inactiveUnread}
          tab={tab}
          selectedClient={selectedClient}
          threadMessages={threadMessages}
          currentUserId={session.user.id}
        />
      </div>
    </>
  )
}

async function loadMessages(clientId: string, trainerId: string) {
  const msgs = await prisma.message.findMany({
    where: { clientId, channel: 'TRAINER_CLIENT', client: { trainerId } },
    include: { sender: { select: { name: true, email: true } } },
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
  }))
}
