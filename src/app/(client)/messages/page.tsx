import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MessageThread } from './message-thread'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function ClientMessagesPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const clientProfile = await prisma.clientProfile.findFirst({
    where: { userId: session.user.id },
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

  // Mark unread messages as read for client
  const unreadIds = messages.filter(m => !m.readAt && m.senderId !== session.user.id).map(m => m.id)
  if (unreadIds.length > 0) {
    await prisma.message.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  const trainerName = clientProfile.trainer.user.name ?? clientProfile.trainer.user.email

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <div className="h-9 w-9 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
          {trainerName[0].toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-slate-900 text-sm">{trainerName}</p>
          <p className="text-xs text-slate-500">Your trainer</p>
        </div>
      </div>

      <MessageThread
        clientId={clientProfile.id}
        currentUserId={session.user.id}
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
