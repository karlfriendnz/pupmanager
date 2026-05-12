import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { getInitials } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Progress & Analytics' }

export default async function ProgressPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      diaryEntries: {
        where: { date: { gte: sevenDaysAgo } },
        include: { completion: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Build per-client compliance
  const clientStats = clients.map((c) => {
    const assigned = c.diaryEntries.length
    const completed = c.diaryEntries.filter(t => t.completion).length
    const rate = assigned > 0 ? Math.round((completed / assigned) * 100) : null
    return { ...c, assigned, completed, rate }
  })

  // Sort: low compliance first
  clientStats.sort((a, b) => {
    if (a.rate === null && b.rate === null) return 0
    if (a.rate === null) return 1
    if (b.rate === null) return -1
    return a.rate - b.rate
  })

  return (
    <>
      <PageHeader title="Progress & Analytics" subtitle="7-day compliance overview for all clients" />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">

      {clientStats.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p>No clients yet. Invite your first client to see their compliance.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clientStats.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`}>
              <Card className="p-4 hover:border-blue-200 transition-all cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {getInitials(c.user.name ?? c.user.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      {c.user.name ?? c.user.email}
                    </p>
                    <p className="text-xs text-slate-400">
                      {c.assigned} tasks assigned · {c.completed} completed
                    </p>
                    {/* Compliance bar */}
                    {c.rate !== null && (
                      <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.rate >= 70 ? 'bg-green-500' : c.rate >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${c.rate}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {c.rate !== null ? (
                      <>
                        <p className={`text-xl font-bold ${c.rate >= 70 ? 'text-green-600' : c.rate >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                          {c.rate}%
                        </p>
                        {c.rate < 40 && (
                          <p className="text-xs text-red-400">Needs attention</p>
                        )}
                        {c.rate >= 70 && (
                          <p className="text-xs text-green-500">On track 🎉</p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">No tasks</p>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      </div>
    </>
  )
}
