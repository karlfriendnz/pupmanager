import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Messages' }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const sp = await searchParams
  const tab = sp.tab === 'inactive' ? 'inactive' : 'active'

  // Pull every client (both active and inactive) so the tabs can count
  // and filter without a second round-trip. INACTIVE clients can still
  // message a trainer (their account isn't locked) so we don't want to
  // hide them — but they live behind a second tab to keep the active
  // list clean.
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

  // Most-recent-message first, but always keep clients with unread on
  // top regardless of how stale the thread's last message timestamp is.
  function sortKey(c: typeof clients[number]): number {
    const lastMs = c.messages[0]?.createdAt?.getTime() ?? 0
    const unreadBonus = c._count.messages > 0 ? Number.MAX_SAFE_INTEGER / 2 : 0
    return lastMs + unreadBonus
  }
  const sorted = [...clients].sort((a, b) => sortKey(b) - sortKey(a))

  const activeClients   = sorted.filter(c => c.status === 'ACTIVE')
  const inactiveClients = sorted.filter(c => c.status === 'INACTIVE')
  const newClients      = sorted.filter(c => c.status === 'NEW')
  // NEW clients haven't accepted the invite yet — bucket them with
  // active for the messaging list so the trainer can still chat them
  // while onboarding.
  const activeBucket = [...activeClients, ...newClients]
  const inactiveBucket = inactiveClients

  const activeUnread   = activeBucket.reduce((sum, c) => sum + c._count.messages, 0)
  const inactiveUnread = inactiveBucket.reduce((sum, c) => sum + c._count.messages, 0)

  const visible = tab === 'inactive' ? inactiveBucket : activeBucket

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <PageHeader title="Messages" />
      <p className="text-sm text-slate-500 mb-4">Private conversations with your clients</p>

      {/* Active / Inactive tabs — unread badges sit on each tab so a
          message arriving from an inactive client surfaces without the
          trainer needing to remember to flip filters. */}
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {([
          { key: 'active',   label: 'Active',   count: activeBucket.length,   unread: activeUnread },
          { key: 'inactive', label: 'Inactive', count: inactiveBucket.length, unread: inactiveUnread },
        ] as const).map(t => (
          <Link
            key={t.key}
            href={t.key === 'active' ? '/messages' : `/messages?tab=${t.key}`}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium -mb-px',
              tab === t.key ? 'text-blue-700 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              <span className={cn(
                'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] tabular-nums',
                tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
              )}>
                {t.count}
              </span>
              {t.unread > 0 && (
                <span
                  aria-label={`${t.unread} unread`}
                  className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold tabular-nums"
                >
                  {t.unread > 9 ? '9+' : t.unread}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">
            {tab === 'inactive' ? 'No inactive clients' : 'No active clients yet'}
          </p>
          <p className="text-sm mt-1">
            {tab === 'inactive' ? 'Inactive clients with threads will show up here.' : 'Invite a client to start messaging.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(client => {
            const lastMsg = client.messages[0]
            const displayName = client.user.name ?? client.user.email
            const unread = client._count.messages
            return (
              <Link key={client.id} href={`/messages/${client.id}`}>
                <Card className={cn(
                  'hover:border-blue-200 hover:shadow-md transition-all cursor-pointer',
                  unread > 0 && 'border-blue-200 bg-blue-50/30',
                )}>
                  <CardBody className="pt-4 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-10 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                        {displayName[0].toUpperCase()}
                        {unread > 0 && (
                          <span
                            aria-label={`${unread} unread`}
                            className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-white"
                          >
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn(
                            'text-sm truncate',
                            unread > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-900',
                          )}>
                            {displayName}{client.dog ? ` · ${client.dog.name}` : ''}
                          </p>
                          {lastMsg && (
                            <span className={cn(
                              'text-xs flex-shrink-0 tabular-nums',
                              unread > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400',
                            )}>
                              {new Date(lastMsg.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                        {lastMsg ? (
                          <p className={cn(
                            'text-xs truncate mt-0.5',
                            unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500',
                          )}>
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
