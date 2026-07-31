import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { listClientMessageThreads } from '@/lib/client-message-threads'
import { MessageThread } from './message-thread'
import { MessagesList } from './messages-list'
import { GroupThread } from './group-thread'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

// Messages, for a dog owner. Three screens behind one route:
//
//   /my-messages?group=<id>  one group thread (or its consent invitation)
//   /my-messages?thread=1    the 1:1 thread with the business, explicitly
//   /my-messages             the list — UNLESS they're in no groups, in which
//                            case a list of one row is chrome for nothing and
//                            the 1:1 thread opens directly, exactly as it
//                            always has.
//
// That last branch is the whole reason this is not a plain list: for the many
// clients who belong to no groups, Messages must stay the single conversation
// it has always been rather than gaining a lobby they have to tap through.
export default async function ClientMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; thread?: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const clientProfile = await prisma.clientProfile.findFirst({
    where: { id: active.clientId },
    include: {
      // businessName is the client-facing label; NEVER expose the trainer's
      // private User.email to the client.
      trainer: { select: { id: true, businessName: true, user: { select: { name: true } } } },
    },
  })
  if (!clientProfile) redirect('/login')

  const trainerName = clientProfile.trainer.user.name ?? clientProfile.trainer.businessName ?? 'Your trainer'
  const businessName = clientProfile.trainer.businessName ?? trainerName
  const { group: groupParam, thread: threadParam } = await searchParams

  if (groupParam) {
    // The group id arrives from a URL, so it is never trusted: this membership
    // check is scoped by the ACTIVE business, which is what stops a link to
    // business A's group opening while the client is looking at business B.
    // (The API re-checks independently — this only decides what we render.)
    const membership = await prisma.messageGroupParticipant.findFirst({
      where: {
        groupId: groupParam,
        userId: active.userId,
        leftAt: null,
        group: { is: { trainerId: clientProfile.trainer.id } },
      },
      select: {
        // The name other members would see. Handed to the consent screen so a
        // client can change it BEFORE agreeing to be visible, not after.
        displayName: true,
        group: { select: { id: true, name: true } },
      },
    })
    if (!membership) redirect('/my-messages')

    return (
      <GroupThread
        groupId={membership.group.id}
        initialName={membership.group.name}
        initialDisplayName={membership.displayName}
        businessName={businessName}
        currentUserId={active.userId}
      />
    )
  }

  const rows = await listClientMessageThreads({
    clientId: clientProfile.id,
    userId: active.userId,
    trainerId: clientProfile.trainer.id,
    trainerName,
  })
  const hasGroups = rows.some(r => r.kind === 'group')

  if (hasGroups && threadParam !== '1') {
    return <MessagesList rows={rows} />
  }

  const messages = await prisma.message.findMany({
    where: { clientId: clientProfile.id, channel: 'TRAINER_CLIENT' },
    include: { sender: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // Mark unread messages as read — but only when the real client is viewing.
  // Trainer-in-preview should leave the read state untouched so it still
  // reflects the client's true unread badge.
  if (!active.isPreview) {
    const unreadIds = messages.filter(m => !m.readAt && m.senderId !== active.userId).map(m => m.id)
    if (unreadIds.length > 0) {
      await prisma.message.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
    }
  }

  return (
    // Full-height chat surface — fills <main>'s flex column. On mobile it
    // reclaims main's pb-24 (the bottom tab-nav gutter) so the composer sits
    // flush above the tabs. On desktop main has no bottom padding, so there's
    // nothing to reclaim — a negative margin there just forces this flex child
    // 2rem past the viewport, scrolling the whole page and clipping the
    // composer. The header pins top, messages scroll in the middle, composer
    // pins bottom — the page itself never scrolls.
    <div className="flex flex-col flex-1 min-h-0 -mb-24 md:mb-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white flex-shrink-0">
        {/* Back only exists when there IS a list to go back to. A client in no
            groups arrives here directly and has nowhere to return to. */}
        {hasGroups && (
          <Link
            href="/my-messages"
            aria-label="Back to messages"
            className="-ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full active:bg-slate-100"
          >
            <ArrowLeft className="h-5 w-5 text-slate-700" strokeWidth={1.75} />
          </Link>
        )}
        <div className="h-9 w-9 rounded-full bg-accent-soft text-accent font-bold text-sm flex items-center justify-center flex-shrink-0">
          {trainerName[0].toUpperCase()}
        </div>
        {/* The name alone is the whole label — a chat header doesn't need to
            say what the other person is, and "your trainer" is wrong for a
            groomer, walker or daycare. */}
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{trainerName}</p>
        </div>
      </div>

      <MessageThread
        clientId={clientProfile.id}
        currentUserId={active.userId}
        initialMessages={messages.map(m => ({
          id: m.id,
          body: m.body,
          senderId: m.senderId,
          createdAt: m.createdAt.toISOString(),
          sender: m.sender,
        }))}
      />
    </div>
  )
}
