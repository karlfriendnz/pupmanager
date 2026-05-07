import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { Card, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const notifications = await prisma.notification.findMany({
    where: { userId: active.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

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
