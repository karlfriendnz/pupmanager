import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      messages: {
        where: { channel: 'TRAINER_CLIENT' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { sender: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Sort clients by most recent message
  const sorted = [...clients].sort((a, b) => {
    const aTime = a.messages[0]?.createdAt?.getTime() ?? 0
    const bTime = b.messages[0]?.createdAt?.getTime() ?? 0
    return bTime - aTime
  })

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Messages</h1>
      <p className="text-sm text-slate-500 mb-6">Private conversations with your clients</p>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Invite a client to start messaging</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map(client => {
            const lastMsg = client.messages[0]
            const displayName = client.user.name ?? client.user.email
            return (
              <Link key={client.id} href={`/messages/${client.id}`}>
                <Card className="hover:border-blue-200 hover:shadow-md transition-all cursor-pointer">
                  <CardBody className="pt-4 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                        {displayName[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900 text-sm">
                            {displayName}{client.dog ? ` · ${client.dog.name}` : ''}
                          </p>
                          {lastMsg && (
                            <span className="text-xs text-slate-400 flex-shrink-0">
                              {new Date(lastMsg.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                        {lastMsg ? (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {lastMsg.sender.name ?? 'Unknown'}: {lastMsg.body}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 mt-0.5 italic">No messages yet</p>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
