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
      trainer: { include: { user: { select: { name: true, email: true } } } },
    },
  })
  if (!clientProfile) redirect('/login')

  const messages = await prisma.message.findMany({
    where: { clientId: clientProfile.id, channel: 'TRAINER_CLIENT' },
    include: { sender: { select: { name: true, email: true } } },
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

  const trainerName = clientProfile.trainer.user.name ?? clientProfile.trainer.user.email

  return (
    // Full-height chat surface — fills <main>'s flex column and reclaims
    // its pb-24 padding (mobile) / pb-8 padding (desktop) so the composer
    // sits flush above the bottom tab nav. The trainer header sits at
    // top, messages scroll in the middle, composer pins at bottom — no
    // sticky positioning needed because the page itself never scrolls.
    <div className="flex flex-col flex-1 min-h-0 -mb-24 md:-mb-8">
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
