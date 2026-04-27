import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'
import { ClientsList } from './clients-list'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clients' }

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const sp = await searchParams
  const tab = sp.tab === 'inactive' ? 'inactive' : sp.tab === 'new' ? 'new' : 'active'
  const status = tab === 'active' ? 'ACTIVE' : tab === 'inactive' ? 'INACTIVE' : 'NEW'

  const [newCount, activeCount, inactiveCount] = await Promise.all([
    prisma.clientProfile.count({ where: { trainerId, status: 'NEW' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'ACTIVE' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'INACTIVE' } }),
  ])

  // Fetch the full tab unfiltered — search now happens client-side as the user
  // types so there's no per-keystroke round-trip. For trainer client lists
  // (typically <500) the bandwidth and JS-filter cost is trivial.
  const ownedClients = await prisma.clientProfile.findMany({
    where: { trainerId, status },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true, breed: true } },
      dogs: { select: { name: true } },
      diaryEntries: {
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { user: { name: 'asc' } },
  })

  // CO_MANAGE shared clients (only show in active tab)
  const sharedClients = (tab === 'active') ? await prisma.clientShare.findMany({
    where: { sharedWithId: trainerId, shareType: 'CO_MANAGE' },
    include: {
      client: {
        include: {
          user: { select: { name: true, email: true } },
          dog: { select: { name: true, breed: true } },
          dogs: { select: { name: true } },
          diaryEntries: {
            where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            select: { id: true, completion: { select: { id: true } } },
          },
        },
      },
    },
  }) : []

  // Fetch the next upcoming session per client (across all trainers — a shared
  // client's "next session" is whichever comes soonest, regardless of who
  // scheduled it).
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

  // Flatten owned + shared into one row shape so the client component can
  // filter and render uniformly.
  const flatClients = [
    ...ownedClients.map(c => ({
      id: c.id,
      name: c.user.name,
      email: c.user.email,
      dogName: c.dog?.name ?? null,
      dogBreed: c.dog?.breed ?? null,
      extraDogNames: c.dogs.map(d => d.name),
      taskCount: c.diaryEntries.length,
      completedCount: c.diaryEntries.filter(t => t.completion).length,
      nextSessionAt: nextSessionByClient.get(c.id)?.toISOString() ?? null,
      shared: false,
    })),
    ...sharedClients.map(s => ({
      id: s.client.id,
      name: s.client.user.name,
      email: s.client.user.email,
      dogName: s.client.dog?.name ?? null,
      dogBreed: s.client.dog?.breed ?? null,
      extraDogNames: s.client.dogs.map(d => d.name),
      taskCount: s.client.diaryEntries.length,
      completedCount: s.client.diaryEntries.filter(t => t.completion).length,
      nextSessionAt: nextSessionByClient.get(s.client.id)?.toISOString() ?? null,
      shared: true,
    })),
  ]

  // Locale-aware case-insensitive sort by display label.
  flatClients.sort((a, b) =>
    (a.name ?? a.email).toLocaleLowerCase('en-NZ')
      .localeCompare((b.name ?? b.email).toLocaleLowerCase('en-NZ'))
  )

  function tabHref(t: string) {
    return t === 'active' ? '/clients' : `/clients?tab=${t}`
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

      <ClientsList clients={flatClients} tab={tab} />
    </div>
  )
}
