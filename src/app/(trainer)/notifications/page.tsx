import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Bell } from 'lucide-react'
import { PhoneRowList } from '@/components/shared/flat-list'
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
    //
    // NULL-safe: `type != 'NEW_MESSAGE'` in SQL never matches a NULL type, and
    // Prisma's `not`/`NOT` both compile to that — so either one silently hides
    // every typed-null notification, which is exactly what "Payment received"
    // rows are (created without a type). That emptied the whole feed for
    // trainers whose only notifications were payments. The explicit null branch
    // keeps them; only real NEW_MESSAGE rows are dropped.
    where: { userId, OR: [{ type: null }, { type: { not: 'NEW_MESSAGE' } }] },
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
    // Full width, like every other list. A notification row is a title, a
    // sentence of body and a date, and it was running down a 768px column with
    // the body wrapping to three lines while half the screen sat empty.
    <div className="w-full px-5 py-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Notifications</h1>

      {notifications.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          {/* A line icon, not an emoji. Every other empty state in the app
              draws one; an emoji renders in the reader's own font and is the
              one piece of type here nobody chose. */}
          <Bell className="mx-auto mb-3 h-8 w-8 text-slate-300" strokeWidth={1.75} />
          <p>No notifications yet</p>
        </div>
      ) : (
        <PhoneRowList className="md:flex md:flex-col md:gap-3">
          {notifications.map((n) => {
            const Icon = iconForNotification(n.type)
            const inner = (
              <CardBody className="px-4 py-3 md:pt-4 md:pb-4">
                <div className="flex items-start gap-3">
                  {/* A plain line icon. It was a tinted rounded chip in the
                      trainer's accent — the tell AGENTS.md names first, and
                      fifty of them down a feed is fifty coloured squares. */}
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 text-sm">{n.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(n.createdAt)}</span>
                </div>
              </CardBody>
            )
            // Phone: rows in one block; desktop keeps the cards.
            const flat = 'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm'
            // A notification with a deep link taps through to what it's about.
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                <Card className={`transition-colors hover:bg-slate-50 ${flat} ${n.readAt ? 'opacity-60' : ''}`}>{inner}</Card>
              </Link>
            ) : (
              <Card key={n.id} className={`${flat} ${n.readAt ? 'opacity-60' : ''}`}>{inner}</Card>
            )
          })}
        </PhoneRowList>
      )}
    </div>
  )
}
