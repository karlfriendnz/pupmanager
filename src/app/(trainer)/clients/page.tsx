import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserPlus, Search, Dog, Calendar } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clients' }

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const sp = await searchParams
  const query = sp.q ?? ''
  const tab = sp.tab === 'inactive' ? 'inactive' : sp.tab === 'new' ? 'new' : 'active'
  const status = tab === 'active' ? 'ACTIVE' : tab === 'inactive' ? 'INACTIVE' : 'NEW'

  const [newCount, activeCount, inactiveCount] = await Promise.all([
    prisma.clientProfile.count({ where: { trainerId, status: 'NEW' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'ACTIVE' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'INACTIVE' } }),
  ])

  const ownedClients = await prisma.clientProfile.findMany({
    where: {
      trainerId,
      status,
      user: query
        ? { name: { contains: query, mode: 'insensitive' } }
        : undefined,
    },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true, breed: true } },
      diaryEntries: {
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { user: { name: 'asc' } },
  })

  // CO_MANAGE shared clients (only show in active tab)
  const sharedClients = (tab === 'active') ? await prisma.clientShare.findMany({
    where: {
      sharedWithId: trainerId,
      shareType: 'CO_MANAGE',
      client: query
        ? { user: { name: { contains: query, mode: 'insensitive' } } }
        : undefined,
    },
    include: {
      client: {
        include: {
          user: { select: { name: true, email: true } },
          dog: { select: { name: true, breed: true } },
          diaryEntries: {
            where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            select: { id: true, completion: { select: { id: true } } },
          },
        },
      },
    },
  }) : []

  // SQL ASCII-sorts strings ('Z' before 'a'); apply a locale-aware case-
  // insensitive sort so display order matches user expectations.
  const labelOf = (c: { user: { name: string | null; email: string } }) =>
    (c.user.name ?? c.user.email).toLocaleLowerCase('en-NZ')
  ownedClients.sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
  sharedClients.sort((a, b) => labelOf(a.client).localeCompare(labelOf(b.client)))

  // Fetch the next upcoming session per client (across all trainers — a shared
  // client's "next session" is whichever comes soonest, regardless of who
  // scheduled it). One query, distinct on clientId after sorting ascending.
  const allClientIds = [
    ...ownedClients.map(c => c.id),
    ...sharedClients.map(s => s.client.id),
  ]
  const upcomingSessions = allClientIds.length > 0
    ? await prisma.trainingSession.findMany({
        where: {
          clientId: { in: allClientIds },
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        distinct: ['clientId'],
        select: { clientId: true, scheduledAt: true },
      })
    : []
  const nextSessionByClient = new Map<string, Date>()
  for (const s of upcomingSessions) {
    if (s.clientId) nextSessionByClient.set(s.clientId, s.scheduledAt)
  }

  function tabHref(t: string) {
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    if (t !== 'active') p.set('tab', t)
    return `/clients${p.toString() ? `?${p}` : ''}`
  }

  const isNew = tab === 'new'

  function ClientCard({ client, shared }: {
    client: typeof ownedClients[0],
    shared?: boolean,
  }) {
    const taskCount = client.diaryEntries.length
    const completedCount = client.diaryEntries.filter(t => t.completion).length
    const complianceRate = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : null
    const nextSession = nextSessionByClient.get(client.id) ?? null

    return (
      <Link key={client.id} href={`/clients/${client.id}`}>
        <Card className={`p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer ${tab === 'inactive' ? 'opacity-70' : ''} ${tab === 'new' ? 'border-amber-200 bg-amber-50/30' : ''}`}>
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              {getInitials(client.user.name ?? client.user.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900 truncate">
                  {client.user.name ?? client.user.email}
                </p>
                {shared && (
                  <span className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                    Shared
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 truncate">
                {client.dog ? `🐕 ${client.dog.name}${client.dog.breed ? ` · ${client.dog.breed}` : ''}` : 'No dog added yet'}
              </p>
              {nextSession && (
                <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Next: {nextSession.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}
                  {nextSession.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              {complianceRate !== null ? (
                <>
                  <p className={`text-lg font-bold ${complianceRate >= 70 ? 'text-green-600' : complianceRate >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                    {complianceRate}%
                  </p>
                  <p className="text-xs text-slate-400">7-day compliance</p>
                </>
              ) : (
                <p className="text-xs text-slate-400">No tasks assigned</p>
              )}
            </div>
          </div>
        </Card>
      </Link>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {newCount > 0 && <>{newCount} new · </>}{activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <Link href="/clients/invite">
          <Button size="sm">
            <UserPlus className="h-4 w-4" />
            Invite client
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-6">
        {newCount > 0 && (
          <Link
            href={tabHref('new')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-center transition-all duration-150 ${
              tab === 'new'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            New<span className="ml-1.5 text-xs opacity-60">{newCount}</span>
          </Link>
        )}
        <Link
          href={tabHref('active')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-center transition-all duration-150 ${
            tab === 'active'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Active{activeCount > 0 && <span className="ml-1.5 text-xs opacity-60">{activeCount}</span>}
        </Link>
        <Link
          href={tabHref('inactive')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-center transition-all duration-150 ${
            tab === 'inactive'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Inactive{inactiveCount > 0 && <span className="ml-1.5 text-xs opacity-60">{inactiveCount}</span>}
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <form>
          {tab === 'inactive' && <input type="hidden" name="tab" value="inactive" />}
          <input
            name="q"
            defaultValue={query}
            placeholder={`Search ${tab === 'active' ? 'active' : 'inactive'} clients...`}
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>
      </div>

      {ownedClients.length === 0 && sharedClients.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Dog className="h-12 w-12 mx-auto mb-3 opacity-30" />
          {tab === 'new' ? (
            <>
              <p className="font-medium">No new registrations</p>
              <p className="text-sm mt-1">Clients who register via your embed forms will appear here</p>
              <Link href="/forms" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
                Manage embed forms →
              </Link>
            </>
          ) : tab === 'active' ? (
            <>
              <p className="font-medium">No active clients</p>
              <p className="text-sm mt-1">Invite your first client to get started</p>
              <Link href="/clients/invite" className="mt-4 inline-block">
                <Button size="sm"><UserPlus className="h-4 w-4" />Invite client</Button>
              </Link>
            </>
          ) : (
            <>
              <p className="font-medium">No inactive clients</p>
              <p className="text-sm mt-1">Clients you mark as inactive will appear here</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {ownedClients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
          {sharedClients.map((share) => (
            <ClientCard key={share.client.id} client={share.client} shared />
          ))}
        </div>
      )}
    </div>
  )
}
