import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { nextSessionByClient as nextSessionForClients } from '@/lib/client-sessions'
import { getTrainerContext, scopeForMember } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { extraClientDogs } from '@/lib/dogs'
import { ClientsList } from './clients-list'
import { whereForView, viewFromTab, VIEW_LABEL, VIEW_BLURB, type ClientView } from '@/lib/client-activity'
import { QuickAddModal } from './quick-add-contact'
import { PageHeader } from '@/components/shared/page-header'
import { AddonNudge } from '@/components/shared/addon-nudge'
import { isNudgeDismissed } from '@/lib/nudge-dismissals'
import { addonNudge } from '@/components/shared/addon-nudge-registry'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clients' }

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; scope?: string }>
}) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')

  const trainerId = ctx.companyId
  // Staff without clients.viewAll see only clients assigned to them.
  const memberScope = scopeForMember(ctx, 'clients.viewAll')

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
  // Which of the four lists we're on. Activity is derived from what the client
  // has booked (see lib/client-activity) — it is NOT read off a status column
  // somebody has to keep up to date. The old ?tab=new / ?tab=inactive links
  // still resolve, to the view holding the same people they always did.
  const view = viewFromTab(sp.tab)
  // One `now` for the whole render, so the counts and the list can't disagree
  // because a session started between two queries.
  const now = new Date()

  // Start the independent list queries together so they run in parallel against
  // the remote DB (awaited below where first used).
  const ownedClientsP = prisma.clientProfile.findMany({
    where: { trainerId, ...whereForView(view, now), ...memberScope },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { id: true, name: true, breed: true, photoUrl: true } },
      // `id` matters: the primary dog may ALSO be on the household list, and
      // the "extra dogs" column/badge has to exclude it or a one-dog client
      // reads "Bailey  +1 Bailey".
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true } },
      diaryEntries: {
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { user: { name: 'asc' } },
  })
  const sharedClientsP = (view === 'current') ? prisma.clientShare.findMany({
    where: { sharedWithId: trainerId, shareType: 'CO_MANAGE' },
    include: {
      client: {
        include: {
          user: { select: { name: true, email: true } },
          dog: { select: { id: true, name: true, breed: true, photoUrl: true } },
          dogs: { select: { id: true, name: true, breed: true, photoUrl: true } },
          diaryEntries: {
            where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            select: { id: true, completion: { select: { id: true } } },
          },
        },
      },
    },
  }) : Promise.resolve([])
  const customFieldsP = prisma.customField.findMany({
    where: { trainerId },
    select: { id: true, label: true, appliesTo: true },
    orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
  })

  const [currentCount, pastCount, neverCount, archivedCount] = await Promise.all([
    prisma.clientProfile.count({ where: { trainerId, ...whereForView('current', now), ...memberScope } }),
    prisma.clientProfile.count({ where: { trainerId, ...whereForView('past', now), ...memberScope } }),
    prisma.clientProfile.count({ where: { trainerId, ...whereForView('never', now), ...memberScope } }),
    prisma.clientProfile.count({ where: { trainerId, ...whereForView('archived', now), ...memberScope } }),
  ])

  // Fetch the full tab unfiltered — search now happens client-side as the user
  // types so there's no per-keystroke round-trip. For trainer client lists
  // (typically <500) the bandwidth and JS-filter cost is trivial.
  const ownedClients = await ownedClientsP
  const sharedClients = await sharedClientsP

  // Fetch the next upcoming session per client (across all trainers — a shared
  // client's "next session" is whichever comes soonest, regardless of who
  // scheduled it).
  const allClientIds = [
    ...ownedClients.map(c => c.id),
    ...sharedClients.map(s => s.client.id),
  ]
  // Across 1:1 AND class enrolments — a class session isn't linked to the
  // client directly, so querying trainingSession by clientId alone left anyone
  // who only does classes showing no next session at all.
  const nextSessionByClient = await nextSessionForClients(allClientIds)

  // Flatten owned + shared into one row shape so the client component can
  // filter and render uniformly.
  const flatClients = [
    ...ownedClients.map(c => ({
      id: c.id,
      name: c.user.name,
      email: c.user.email,
      // Fall back to an additional dog: a household whose dogs were all added
      // as extras has no PRIMARY, and read "No dog" here while their profile
      // listed four. (The photo already fell back; the name didn't.)
      dogName: c.dog?.name ?? c.dogs[0]?.name ?? null,
      dogBreed: c.dog?.breed ?? c.dogs[0]?.breed ?? null,
      dogPhotoUrl: c.dog?.photoUrl ?? c.dogs[0]?.photoUrl ?? null,
      extraDogNames: extraClientDogs(c.dogId, c.dogs).map(d => d.name),
      taskCount: c.diaryEntries.length,
      completedCount: c.diaryEntries.filter(t => t.completion).length,
      nextSessionAt: nextSessionByClient.get(c.id)?.toISOString() ?? null,
      shared: false,
    })),
    ...sharedClients.map(s => ({
      id: s.client.id,
      name: s.client.user.name,
      email: s.client.user.email,
      dogName: s.client.dog?.name ?? s.client.dogs[0]?.name ?? null,
      dogBreed: s.client.dog?.breed ?? s.client.dogs[0]?.breed ?? null,
      dogPhotoUrl: s.client.dog?.photoUrl ?? s.client.dogs[0]?.photoUrl ?? null,
      extraDogNames: extraClientDogs(s.client.dogId, s.client.dogs).map(d => d.name),
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
  const customFields = await customFieldsP
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

  function tabHref(v: ClientView) {
    return v === 'current' ? '/clients' : `/clients?tab=${v}`
  }
  // Archived only earns a tab once somebody has archived someone — an empty
  // fourth tab is a permanent reminder of a feature most trainers never use.
  const TABS: ClientView[] = archivedCount > 0
    ? ['current', 'past', 'never', 'archived']
    : ['current', 'past', 'never']
  const COUNTS: Record<ClientView, number> = {
    current: currentCount, past: pastCount, never: neverCount, archived: archivedCount,
  }

  // Nudge: promote bulk client email (Marketing) when it isn't switched on.
  const isDevPreview = process.env.NODE_ENV === 'development'
  const marketingNudge = addonNudge('marketing')
  const showMarketingNudge = !(await hasAddon(trainerId, 'marketing')) && !!marketingNudge
  const marketingNudgeDismissed = await isNudgeDismissed(ctx.userId, 'clients-marketing')

  return (
    <>
      {/* No subtitle: the tabs below already carry these counts ("Active 55",
          "Inactive 6"). No add buttons either — the global "+" offers Quick
          client and Full client by name, on every page and both layouts. */}
      <PageHeader title="Clients" />
      {/* Single quick-add modal for the whole page — opens from ?new=1 (the
          header button, the top bar's + menu, or the mobile FAB). Mounted once
          here so it never double-renders like a header action would. */}
      <QuickAddModal />
      <div className="p-4 md:p-8 w-full max-w-4xl xl:max-w-7xl mx-auto">


      <ClientsList
        key={`${sp.q ?? ''}|${sp.scope ?? ''}`}
        clients={flatClients}
        view={view}
        // Plain data only — the icons are picked inside the client component,
        // because a Lucide icon is a function and can't cross this boundary.
        tabs={TABS.map(v => ({ id: v, label: VIEW_LABEL[v], href: tabHref(v) }))}
        blurb={VIEW_BLURB[view]}
        columns={clientListColumns}
        customFields={customFields}
        customValues={customValueMap}
        groupBy={clientListGroupBy}
        tz={tz}
        initialQuery={sp.q}
        searchScope={(['client', 'breed', 'dog'].includes(sp.scope ?? '') ? sp.scope : 'all') as 'all' | 'client' | 'breed' | 'dog'}
      />
      </div>
      {showMarketingNudge && marketingNudge && (
        <AddonNudge id="clients-marketing" {...marketingNudge} forceShow={isDevPreview} dismissed={marketingNudgeDismissed} />
      )}
    </>
  )
}
