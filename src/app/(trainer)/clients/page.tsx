import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'
import { ClientsList } from './clients-list'
import { WaitlistView } from './waitlist-view'
import { PageHeader } from '@/components/shared/page-header'
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
  if (!trainerId) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { clientListColumns: true, clientListGroupBy: true, user: { select: { timezone: true } } },
  })
  const clientListColumns = Array.isArray(trainerProfile?.clientListColumns)
    ? trainerProfile.clientListColumns as string[]
    : ['email', 'dog', 'nextSession', 'compliance']
  const clientListGroupBy = trainerProfile?.clientListGroupBy ?? null
  // Trainer's configured tz — every date in the list renders in it.
  const tz = trainerProfile?.user?.timezone ?? 'Pacific/Auckland'

  const sp = await searchParams
  const tab =
    sp.tab === 'inactive' ? 'inactive'
    : sp.tab === 'new' ? 'new'
    : sp.tab === 'waitlist' ? 'waitlist'
    : 'active'
  const status = tab === 'inactive' ? 'INACTIVE' : tab === 'new' ? 'NEW' : 'ACTIVE'

  const [newCount, activeCount, inactiveCount, waitlistCount] = await Promise.all([
    prisma.clientProfile.count({ where: { trainerId, status: 'NEW' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'ACTIVE' } }),
    prisma.clientProfile.count({ where: { trainerId, status: 'INACTIVE' } }),
    prisma.waitlistEntry.count({ where: { trainerId, status: 'WAITING' } }),
  ])

  // Waitlist is a tab on this page (not a separate route). Only its data
  // is fetched when that tab is active; the heavy client-list queries
  // below still run but their results simply aren't rendered.
  const waitlistData =
    tab === 'waitlist'
      ? await (async () => {
          const [entries, activeClients, packages] = await Promise.all([
            prisma.waitlistEntry.findMany({
              where: { trainerId },
              orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
              include: {
                client: { select: { id: true, user: { select: { name: true, email: true } } } },
                package: { select: { id: true, name: true } },
              },
            }),
            prisma.clientProfile.findMany({
              where: { trainerId, status: 'ACTIVE' },
              select: { id: true, user: { select: { name: true } } },
              orderBy: { user: { name: 'asc' } },
            }),
            prisma.package.findMany({
              where: { trainerId },
              orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
              select: { id: true, name: true },
            }),
          ])
          return {
            entries: entries.map(e => ({
              id: e.id,
              clientId: e.clientId,
              name: e.client?.user.name ?? e.name,
              email: e.client?.user.email ?? e.email,
              phone: e.phone,
              packageId: e.packageId,
              packageName: e.package?.name ?? null,
              request: e.request,
              sessionType: e.sessionType,
              preferredDays: e.preferredDays,
              preferredTimeStart: e.preferredTimeStart,
              preferredTimeEnd: e.preferredTimeEnd,
              earliestStart: e.earliestStart ? e.earliestStart.toISOString().slice(0, 10) : null,
              notes: e.notes,
              status: e.status,
              contactedAt: e.contactedAt?.toISOString() ?? null,
              createdAt: e.createdAt.toISOString(),
            })),
            clients: activeClients.map(c => ({ id: c.id, name: c.user.name ?? 'Unnamed client' })),
            packages,
          }
        })()
      : null

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

  // Custom-field columns. The picker shows every custom field defined by the
  // trainer; we only fetch values for fields actually selected (via the
  // "custom:<id>" entries in clientListColumns) to keep page payloads small.
  const customFields = await prisma.customField.findMany({
    where: { trainerId },
    select: { id: true, label: true, appliesTo: true },
    orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
  })
  // Fields whose values we need: any selected as a column AND the field
  // currently used for grouping (if any). Deduplicate.
  const selectedCustomIdsSet = new Set<string>(
    clientListColumns
      .filter(c => c.startsWith('custom:'))
      .map(c => c.slice('custom:'.length)),
  )
  if (clientListGroupBy?.startsWith('custom:')) {
    selectedCustomIdsSet.add(clientListGroupBy.slice('custom:'.length))
  }
  const selectedCustomIds = Array.from(selectedCustomIdsSet).filter(id => customFields.some(f => f.id === id))
  const customValues = (selectedCustomIds.length > 0 && allClientIds.length > 0)
    ? await prisma.customFieldValue.findMany({
        where: { fieldId: { in: selectedCustomIds }, clientId: { in: allClientIds } },
        select: { fieldId: true, clientId: true, dogId: true, value: true },
      })
    : []
  // For DOG-applied fields, prefer the value tied to the client's primary dog;
  // for OWNER fields, dogId is null. Key by `${clientId}:${fieldId}`.
  const primaryDogIdByClient = new Map<string, string | null>([
    ...ownedClients.map(c => [c.id, c.dogId] as const),
    ...sharedClients.map(s => [s.client.id, s.client.dogId] as const),
  ])
  const customValueMap: Record<string, string> = {}
  for (const v of customValues) {
    const key = `${v.clientId}:${v.fieldId}`
    const field = customFields.find(f => f.id === v.fieldId)
    if (field?.appliesTo === 'DOG') {
      const primary = primaryDogIdByClient.get(v.clientId)
      if (v.dogId && primary && v.dogId !== primary) continue
    }
    // Last-write wins; fine since DOG fields are filtered above.
    customValueMap[key] = v.value
  }

  function tabHref(t: string) {
    return t === 'active' ? '/clients' : `/clients?tab=${t}`
  }

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${newCount > 0 ? `${newCount} new · ` : ''}${activeCount} active · ${inactiveCount} inactive`}
        actions={
          <Link href="/clients/invite">
            <Button size="sm">
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Invite client</span>
            </Button>
          </Link>
        }
      />
      <div className="p-4 md:p-8 w-full max-w-4xl xl:max-w-7xl mx-auto">


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
        <Link
          href={tabHref('waitlist')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-center transition-all duration-150 ${
            tab === 'waitlist'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Waitlist{waitlistCount > 0 && <span className="ml-1.5 text-xs opacity-60">{waitlistCount}</span>}
        </Link>
      </div>

      {tab === 'waitlist' && waitlistData ? (
        <WaitlistView
          initialEntries={waitlistData.entries}
          clients={waitlistData.clients}
          packages={waitlistData.packages}
        />
      ) : (
        <ClientsList
          clients={flatClients}
          tab={tab as 'new' | 'active' | 'inactive'}
          columns={clientListColumns}
          customFields={customFields}
          customValues={customValueMap}
          groupBy={clientListGroupBy}
          tz={tz}
        />
      )}
      </div>
    </>
  )
}
