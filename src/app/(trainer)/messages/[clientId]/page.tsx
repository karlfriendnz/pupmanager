import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MessageThread } from './message-thread'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function TrainerMessageThreadPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId } = await params

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
    },
  })
  if (!client) notFound()

  const messages = await prisma.message.findMany({
    where: { clientId, channel: 'TRAINER_CLIENT' },
    include: { sender: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // Mark unread messages as read
  const unreadIds = messages.filter(m => !m.readAt && m.senderId !== session.user.id).map(m => m.id)
  if (unreadIds.length > 0) {
    await prisma.message.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  const displayName = client.user.name ?? client.user.email

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-screen max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <Link href="/messages" className="text-slate-400 hover:text-slate-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
          {displayName[0].toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-slate-900 text-sm">{displayName}</p>
          {client.dog && <p className="text-xs text-slate-500">{client.dog.name}</p>}
        </div>
      </div>

      <MessageThread
        clientId={clientId}
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
