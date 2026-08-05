import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { Card, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { ClientNotificationSettings } from './client-notification-settings'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notifications' }

// Notifications are one subject, so they are one page: what you were told
// (Inbox) and what you want to be told about (Settings). Settings used to be a
// third tab on My Profile, which is the person's details and nothing else.
//
// The tab lives in the URL rather than in React state so `?tab=settings` is a
// real link — /my-profile?tab=notifications forwards straight to it — and so a
// pin from the review widget records which view it was made on.
const TABS = [
  { id: 'inbox', label: 'Inbox', href: '/my-notifications' },
  { id: 'settings', label: 'Settings', href: '/my-notifications?tab=settings' },
] as const

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const { tab } = await searchParams
  const view = tab === 'settings' ? 'settings' : 'inbox'

  // Only the inbox reads the feed — opening Settings shouldn't silently mark
  // everything read.
  const notifications = view === 'inbox'
    ? await prisma.notification.findMany({
        where: { userId: active.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : []

  // Clear the unread badge, exactly as the trainer's feed does — marking AFTER
  // the read so this render still shows which ones were new. Without this a dog
  // owner's notifications stayed unread forever: every row kept its full-opacity
  // "new" styling however many times they looked at it, and any unread count
  // built on readAt could only ever go up.
  const unreadIds = notifications.filter(n => !n.readAt).map(n => n.id)
  if (unreadIds.length > 0) {
    await prisma.notification.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  return (
    <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto w-full" data-review-scope={`Tab: ${view}`}>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Notifications</h1>

      <div className="flex gap-1 mb-6 border-b border-slate-100">
        {TABS.map(t => (
          <Link
            key={t.id}
            href={t.href}
            scroll={false}
            aria-current={view === t.id ? 'page' : undefined}
            className={`px-3 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              view === t.id ? 'border-accent text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === 'settings' ? (
        <ClientNotificationSettings />
      ) : notifications.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-3xl mb-3">🔔</p>
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map((n) => (
            <Card key={n.id} className={n.readAt ? 'opacity-60' : ''}>
              <CardBody className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900 text-sm">{n.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {formatDate(n.createdAt)}
                  </span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
