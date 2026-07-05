import { redirect, notFound } from 'next/navigation'
import { PawPrint } from 'lucide-react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { getClientAccess } from '@/lib/trainer-access'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { routeDistance } from '@/lib/routing'
import { formatDate } from '@/lib/utils'
import { ClientProfileTabs } from './client-profile-tabs'
import { ClientSummaryCard } from './client-summary-card'
import { ClientActionsMenu } from './client-actions-menu'
import { AssignedTrainerControl } from './assigned-trainer-control'
import { PageHeader } from '@/components/shared/page-header'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Client profile' }

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId } = await params

  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()

  const { client: clientAccess, canEdit } = access
  const isPrimaryTrainer = clientAccess.trainerId === access.trainerId

  // One parallel fan-out — every query here only needs `access`, which is
  // already resolved, so there's no reason to run them serially.
  const [
    client,
    trainingSessions,
    customFields,
    packages,
    availabilitySlots,
    teamMembers,
    products,
    pendingProductRequests,
    baseProfile,
  ] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        user: { select: { name: true, email: true, emailVerified: true, createdAt: true } },
        dog: true,
        dogs: true,
        diaryEntries: { orderBy: { date: 'desc' }, take: 20, include: { completion: true } },
        customFieldValues: true,
      },
    }),
    prisma.trainingSession.findMany({
      where: { clientId },
      orderBy: { scheduledAt: 'desc' },
      include: { dog: { select: { name: true } } },
    }),
    // Custom fields from the client's primary trainer.
    prisma.customField.findMany({
      where: { trainerId: clientAccess.trainerId },
      orderBy: { order: 'asc' },
    }),
    // Packages owned by the *current* trainer (co-managers see their own).
    canEdit
      ? prisma.package.findMany({
          where: { trainerId: access.trainerId },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        })
      : Promise.resolve([]),
    canEdit
      ? prisma.availabilitySlot.findMany({
          where: { trainerId: access.trainerId },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        })
      : Promise.resolve([]),
    // Business members for the assigned-trainer picker (primary trainer only).
    (canEdit && isPrimaryTrainer)
      ? prisma.trainerMembership.findMany({
          where: { companyId: clientAccess.trainerId },
          select: { id: true, role: true, user: { select: { name: true, email: true } } },
          orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
        })
      : Promise.resolve([]),
    // Products from the primary trainer's shop (for "Add to next session").
    canEdit
      ? prisma.product.findMany({
          // No `active` filter — the trainer can add ANY of their products to a
          // client, even hidden ones. `active`/`featured` only gate the client's
          // own shop view; the picker badges hidden items so the trainer knows.
          where: { trainerId: clientAccess.trainerId },
          orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
          select: { id: true, name: true, kind: true, priceCents: true, imageUrl: true, category: true, active: true },
        })
      : Promise.resolve([]),
    prisma.productRequest.findMany({
      where: { clientId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, note: true, product: { select: { id: true, name: true, kind: true, imageUrl: true } } },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: access.trainerId },
      select: { baseLat: true, baseLng: true },
    }),
  ])

  if (!client) notFound()

  // Communication records for this client — bulk emails received (with
  // open/click status) + the message/email thread — for the Communication tab.
  // Billing visibility gates the Invoices tab + the Overview unpaid-invoices card
  // (both read the new payment-agnostic Invoice model, fetched client-side).
  const [broadcastEmails, threadMessages, trainerCtx] = await Promise.all([
    prisma.emailBroadcastRecipient.findMany({
      where: { clientProfileId: clientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, status: true, openedAt: true, createdAt: true, broadcast: { select: { subject: true } } },
    }),
    prisma.message.findMany({
      where: { clientId, channel: 'TRAINER_CLIENT' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, body: true, senderId: true, createdAt: true, readAt: true },
    }),
    getTrainerContext(),
  ])
  const canViewBilling = !!trainerCtx && can('billing.view', trainerCtx.role, trainerCtx.permissions)
  const communications = [
    ...broadcastEmails.map(e => ({
      id: `b-${e.id}`,
      kind: 'email' as const,
      direction: 'outbound' as const,
      subject: e.broadcast.subject,
      status: e.status as string | null,
      date: e.createdAt.toISOString(),
    })),
    ...threadMessages.map(m => ({
      id: `m-${m.id}`,
      kind: m.body.startsWith('📧') ? ('email' as const) : ('message' as const),
      direction: m.senderId === client.userId ? ('inbound' as const) : ('outbound' as const),
      subject: m.body.replace(/^📧\s*/, '').split('\n')[0].slice(0, 140),
      status: null as string | null,
      date: m.createdAt.toISOString(),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60)

  // Driving distance from the trainer's base to this client (guarded — null if
  // either has no location set, or Google is unreachable). Gated on the Route
  // planner add-on, which covers all address/distance calculations. One external
  // call after the batch, since it needs both the client's and base's coordinates.
  const clientAppEnabled = await hasAddon(access.trainerId, 'clientapp')

  let distanceFromBase: string | null = null
  if (
    client.addressLat != null && client.addressLng != null &&
    baseProfile?.baseLat != null && baseProfile?.baseLng != null &&
    await hasAddon(access.trainerId, 'routeplanner')
  ) {
    const d = await routeDistance(
      { lat: baseProfile.baseLat, lng: baseProfile.baseLng },
      { lat: client.addressLat, lng: client.addressLng },
    )
    if (d) distanceFromBase = `${(d.distanceMeters / 1000).toFixed(1)} km · ${Math.round(d.durationSec / 60)} min drive`
  }

  const fieldValueMap = Object.fromEntries(client.customFieldValues.map(v => [
    v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId,
    v.value,
  ]))

  const completedTasks = client.diaryEntries.filter(t => t.completion).length
  const complianceRate = client.diaryEntries.length > 0
    ? Math.round((completedTasks / client.diaryEntries.length) * 100)
    : null

  const allDogs = [...(client.dog ? [client.dog] : []), ...client.dogs]
  const dogNames = Object.fromEntries(allDogs.map(d => [d.id, d.name]))

  return (
    <>
      <PageHeader
        title={client.user.name ?? client.user.email ?? 'Client'}
        subtitle={!isPrimaryTrainer ? 'Co-managed' : undefined}
        back={{ href: '/clients', label: 'Back to clients' }}
        actions={
          <ClientActionsMenu
            clientId={client.id}
            clientName={client.user.name ?? client.user.email}
            clientEmail={client.user.email ?? ''}
            canEdit={canEdit}
            isPrimaryTrainer={isPrimaryTrainer}
            clientAppEnabled={clientAppEnabled}
            needsInvite={!client.user.emailVerified}
            members={teamMembers.map(m => ({
              id: m.id,
              name: m.user.name ?? m.user.email,
              role: m.role,
            }))}
            currentMembershipId={trainerCtx?.membershipId ?? null}
            dogs={allDogs.map(d => ({ id: d.id, name: d.name }))}
            packages={packages.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              sessionCount: p.sessionCount,
              weeksBetween: p.weeksBetween,
              durationMins: p.durationMins,
              sessionType: p.sessionType,
            }))}
            availability={availabilitySlots.map(s => ({
              id: s.id,
              dayOfWeek: s.dayOfWeek,
              date: s.date ? s.date.toISOString().split('T')[0] : null,
              startTime: s.startTime,
              endTime: s.endTime,
            }))}
          />
        }
      />
      <div className="p-4 md:p-8 w-full max-w-5xl xl:max-w-7xl mx-auto">

      {client.isSample && (
        <div className="mb-4">
          <SampleRecordBadge />
        </div>
      )}

      {/* Summary sidebar + tabbed content. Desktop: summary sticks to the left,
          tabs scroll on the right. Mobile: the heavy summary card is hidden (its
          contact facts live in the Details tab) in favour of a compact header +
          tabs-at-the-top, so a trainer isn't buried under a full profile card. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="hidden lg:block lg:w-72 lg:flex-shrink-0 xl:w-80 lg:sticky lg:top-8">
        <ClientSummaryCard
          name={client.user.name ?? client.user.email ?? 'Client'}
          status={client.status}
          dog={allDogs[0] ? { name: allDogs[0].name, breed: allDogs[0].breed, photoUrl: allDogs[0].photoUrl } : null}
          dogCount={allDogs.length}
          phone={client.phone}
          email={client.user.email}
          clientSince={formatDate(client.user.createdAt)}
          address={client.addressLine}
          distanceFromBase={distanceFromBase}
          sessionCount={trainingSessions.length}
        />
        {teamMembers.length > 1 && (
          <div className="mt-4">
            <AssignedTrainerControl
              clientId={client.id}
              initialMembershipId={client.assignedMembershipId}
              members={teamMembers.map(m => ({
                id: m.id,
                name: m.user.name ?? m.user.email,
                role: m.role,
              }))}
            />
          </div>
        )}
      </aside>
      <div className="min-w-0 flex-1">
      {/* Compact mobile header — the heavy summary card is desktop-only, so on
          phones we show just the dog photo + name + status, then the tabs. */}
      <div className="lg:hidden mb-4 flex items-center gap-3 rounded-2xl bg-white border border-slate-100 p-3">
        {allDogs[0]?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={allDogs[0].photoUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><PawPrint className="h-6 w-6" /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900">{client.user.name ?? client.user.email ?? 'Client'}</h2>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${client.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {client.status === 'ACTIVE' ? 'Active' : client.status}
            </span>
          </div>
          {allDogs[0] && <p className="truncate text-sm text-slate-500">{allDogs[0].name}{allDogs[0].breed ? ` · ${allDogs[0].breed}` : ''}</p>}
        </div>
      </div>
      <ClientProfileTabs
        clientId={client.id}
        canEdit={canEdit}
        communications={communications}
        canViewBilling={canViewBilling}
        stats={{
          complianceRate,
          completedTasks,
          totalTasks: client.diaryEntries.length,
        }}
        dogs={allDogs.map(d => ({
          id: d.id,
          name: d.name,
          breed: d.breed,
          weight: d.weight,
          dob: d.dob ? d.dob.toISOString() : null,
          notes: d.notes,
        }))}
        products={products.map(p => ({
          id: p.id,
          name: p.name,
          kind: p.kind as 'PHYSICAL' | 'DIGITAL',
          priceCents: p.priceCents,
          imageUrl: p.imageUrl,
          category: p.category,
          active: p.active,
        }))}
        pendingProductRequests={pendingProductRequests.map(r => ({
          id: r.id,
          note: r.note,
          product: {
            id: r.product.id,
            name: r.product.name,
            kind: r.product.kind as 'PHYSICAL' | 'DIGITAL',
            imageUrl: r.product.imageUrl,
          },
        }))}
        tasks={client.diaryEntries.map(t => ({
          id: t.id,
          title: t.title,
          date: t.date.toISOString(),
          dogId: t.dogId,
          completed: !!t.completion,
        }))}
        sessions={trainingSessions.map(s => ({
          id: s.id,
          title: s.title,
          scheduledAt: s.scheduledAt.toISOString(),
          durationMins: s.durationMins,
          sessionType: s.sessionType,
          status: s.status,
          invoicedAt: s.invoicedAt?.toISOString() ?? null,
          location: s.location,
          virtualLink: s.virtualLink,
          description: s.description,
          dogName: s.dog?.name ?? null,
        }))}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
          category: f.category,
        }))}
        fieldValueMap={fieldValueMap}
        dogNames={dogNames}
        contact={{
          email: client.user.email,
          phone: client.phone,
          clientSince: formatDate(client.user.createdAt),
          address: client.addressLine,
          distanceFromBase,
        }}
        status={client.status}
        notes={client.notes}
        clientAppEnabled={clientAppEnabled}
      />
      </div>
      </div>
      </div>
    </>
  )
}
