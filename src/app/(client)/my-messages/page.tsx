import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { MessageThread } from './message-thread'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function ClientMessagesPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const clientProfile = await prisma.clientProfile.findFirst({
    where: { id: active.clientId },
    include: {
      // businessName is the client-facing label; NEVER expose the trainer's
      // private User.email to the client.
      trainer: { select: { businessName: true, user: { select: { name: true } } } },
    },
  })
  if (!clientProfile) redirect('/login')

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

  const trainerName = clientProfile.trainer.user.name ?? clientProfile.trainer.businessName ?? 'Your trainer'

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
        <div className="h-9 w-9 rounded-full bg-accent-soft text-accent font-bold text-sm flex items-center justify-center flex-shrink-0">
          {trainerName[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{trainerName}</p>
          <p className="text-xs text-slate-500">Your trainer</p>
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
