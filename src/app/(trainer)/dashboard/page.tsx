import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { UserPlus, TrendingUp, Calendar, MapPin, Video } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const todaysSessions = await prisma.trainingSession.findMany({
    where: { trainerId, scheduledAt: { gte: todayStart, lte: today } },
    include: {
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      diaryEntries: {
        where: { date: { gte: sevenDaysAgo, lte: today } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const totalClients = clients.length
  const weeklyTasksAssigned = clients.reduce((sum, c) => sum + c.diaryEntries.length, 0)
  const weeklyTasksCompleted = clients.reduce(
    (sum, c) => sum + c.diaryEntries.filter(t => t.completion).length,
    0
  )
  const overallCompliance =
    weeklyTasksAssigned > 0
      ? Math.round((weeklyTasksCompleted / weeklyTasksAssigned) * 100)
      : null

  const lowComplianceClients = clients.filter((c) => {
    const assigned = c.diaryEntries.length
    if (assigned === 0) return false
    const completed = c.diaryEntries.filter(t => t.completion).length
    return completed / assigned < 0.4
  })

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Good {getGreeting()}, {session.user.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-slate-500 text-sm mt-1">{session.user.businessName}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Clients" value={String(totalClients)} />
        <StatCard label="Tasks this week" value={String(weeklyTasksAssigned)} />
        <StatCard label="Completed" value={String(weeklyTasksCompleted)} />
        <StatCard
          label="Compliance"
          value={overallCompliance != null ? `${overallCompliance}%` : '—'}
          highlight={overallCompliance != null}
          highlightGood={overallCompliance != null && overallCompliance >= 70}
        />
      </div>

      {/* Low compliance alert */}
      {lowComplianceClients.length > 0 && (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-100 p-4">
          <p className="font-semibold text-amber-900 mb-2">
            ⚠️ {lowComplianceClients.length} client{lowComplianceClients.length > 1 ? 's' : ''} need attention
          </p>
          <div className="flex flex-col gap-2">
            {lowComplianceClients.map((c) => {
              const rate = Math.round(
                (c.diaryEntries.filter(t => t.completion).length / c.diaryEntries.length) * 100
              )
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between bg-white rounded-xl px-4 py-2.5 hover:border-amber-200 border border-transparent transition-colors"
                >
                  <span className="text-sm font-medium text-slate-700">
                    {c.user.name ?? c.user.email}
                    {c.dog && <span className="text-slate-400"> · {c.dog.name}</span>}
                  </span>
                  <span className="text-sm font-bold text-red-500">{rate}%</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <QuickAction href="/clients/invite" icon={<UserPlus className="h-5 w-5" />} label="Invite client" />
        <QuickAction href="/schedule" icon={<Calendar className="h-5 w-5" />} label="Book session" />
        <QuickAction href="/progress" icon={<TrendingUp className="h-5 w-5" />} label="View progress" />
        <QuickAction href="/schedule" icon={<Calendar className="h-5 w-5" />} label="Schedule" />
      </div>

      {/* Today's sessions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Coming up today</h2>
          <Link href="/schedule" className="text-sm text-blue-600 hover:underline">
            View schedule
          </Link>
        </div>
        {todaysSessions.length === 0 ? (
          <Card className="p-6 text-center">
            <Calendar className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">No sessions scheduled for today.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {todaysSessions.map((s) => {
              const clientUser = s.client?.user ?? s.dog?.primaryFor[0]?.user
              const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
              const start = new Date(s.scheduledAt)
              const isPast = start.getTime() + s.durationMins * 60_000 < new Date().getTime()
              const meta = STATUS_META[s.status]
              return (
                <Link key={s.id} href="/schedule">
                  <Card className={`p-3 hover:border-blue-100 transition-all cursor-pointer ${isPast ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 text-center min-w-[56px]">
                        <p className="text-sm font-bold text-blue-600">
                          {start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </p>
                        <p className="text-[10px] text-slate-400">{s.durationMins}m</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{s.title}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          {clientName && <span className="truncate">{clientName}</span>}
                          {s.dog && <span className="text-slate-400 truncate">🐕 {s.dog.name}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                          {s.sessionType === 'VIRTUAL' ? (
                            <span className="flex items-center gap-1"><Video className="h-3 w-3" />Virtual</span>
                          ) : (
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.location ?? 'In person'}</span>
                          )}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${meta.colour}`}>
                        {meta.label}
                      </span>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const STATUS_META: Record<'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED', { label: string; colour: string }> = {
  UPCOMING:  { label: 'Upcoming',  colour: 'bg-blue-50 text-blue-700 border-blue-200' },
  COMPLETED: { label: 'Completed', colour: 'bg-green-50 text-green-700 border-green-200' },
  COMMENTED: { label: 'Commented', colour: 'bg-amber-50 text-amber-700 border-amber-200' },
  INVOICED:  { label: 'Invoiced',  colour: 'bg-purple-50 text-purple-700 border-purple-200' },
}

function StatCard({
  label,
  value,
  highlight,
  highlightGood,
}: {
  label: string
  value: string
  highlight?: boolean
  highlightGood?: boolean
}) {
  return (
    <Card className="p-4 text-center">
      <p className={`text-2xl font-bold ${highlight ? (highlightGood ? 'text-green-600' : 'text-red-500') : 'text-slate-900'}`}>
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </Card>
  )
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 flex flex-col items-center gap-2 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer text-center">
        <span className="text-blue-600">{icon}</span>
        <span className="text-xs font-medium text-slate-700">{label}</span>
      </Card>
    </Link>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
