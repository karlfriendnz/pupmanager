import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { iconForNotification } from '@/components/shared/notification-icon'
import { formatDate } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notifications' }

// The trainer's in-app notification feed — the same Notification model the
// client feed uses, keyed by the signed-in user. Populated by notifyTrainer for
// any type that lists IN_APP (client logged training, new message/enquiry, …).
// Opening the page marks everything read so the nav badge clears.
export default async function TrainerNotificationsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const userId = session.user.id

  const notifications = await prisma.notification.findMany({
    // Chats are their own thing — they live in Messages, not this feed (they
    // still push + toast). Everything else surfaces here.
    where: { userId, type: { not: 'NEW_MESSAGE' } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Clear the unread badge — mark after loading so this render still shows which
  // were new (readAt was null when we read them).
  const unreadIds = notifications.filter(n => !n.readAt).map(n => n.id)
  if (unreadIds.length > 0) {
    await prisma.notification.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Notifications</h1>

      {notifications.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-3xl mb-3">🔔</p>
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((n) => {
            const Icon = iconForNotification(n.type)
            const inner = (
              <CardBody className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 text-sm">{n.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(n.createdAt)}</span>
                </div>
              </CardBody>
            )
            // A notification with a deep link taps through to what it's about.
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                <Card className={`transition-colors hover:bg-slate-50 ${n.readAt ? 'opacity-60' : ''}`}>{inner}</Card>
              </Link>
            ) : (
              <Card key={n.id} className={n.readAt ? 'opacity-60' : ''}>{inner}</Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
