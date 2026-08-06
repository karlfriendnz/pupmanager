import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadClientSessions } from '@/lib/client-sessions'
import { hasAddon } from '@/lib/billing'
import { classSessionSpaces, sessionCapacity } from '@/lib/class-runs'
import { getClientAccess } from '@/lib/trainer-access'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { routeDistance } from '@/lib/routing'
import { mergeClientDogs } from '@/lib/dogs'
import { formatDate, personLabel } from '@/lib/utils'
import { ClientProfileTabs } from './client-profile-tabs'
import { ClientSummaryCard } from './client-summary-card'
import { ClientActionsPanel } from './client-actions-panel'
import { AssignedTrainerControl } from './assigned-trainer-control'
import { PageHeader } from '@/components/shared/page-header'
import { ProfileHero } from '@/components/shared/profile-hero'
import { dogsLine } from '@/lib/client-profile-summary'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import { packageBookingWindow } from '@/lib/package-booking-window'
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
    openClasses,
    availabilitySlots,
    teamMembers,
    products,
    pendingProductRequests,
    baseProfile,
    trainingLogs,
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
    // 1:1 AND class sessions. A class session belongs to the run, not the
    // client, so the old query returned nothing for someone who only does
    // classes — their record read "Sessions 0" while their own app listed them.
    loadClientSessions(clientId),
    // Custom fields from the client's primary trainer.
    prisma.customField.findMany({
      where: { trainerId: clientAccess.trainerId },
      orderBy: { order: 'asc' },
    }),
    // Packages owned by the *current* trainer (co-managers see their own).
    canEdit
      ? prisma.package.findMany({
          // 1:1 packages only, and never the first-run sample ones: a group
          // package is a class template — you enrol someone into a class run
          // off it, you don't assign the template to one client.
          where: { trainerId: access.trainerId, isGroup: false, isSample: false },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        })
      : Promise.resolve([]),
    // Classes this client could be enrolled into: still running, not finished,
    // with their current roster size so the picker can show seats left.
    canEdit
      ? prisma.classRun.findMany({
          where: { trainerId: access.trainerId, status: { in: ['SCHEDULED', 'RUNNING'] } },
          orderBy: { startDate: 'asc' },
          select: {
            id: true, name: true, scheduleNote: true, startDate: true, capacity: true,
            package: { select: { capacity: true, allowDropIn: true } },
            enrollments: { where: { status: 'ENROLLED' }, select: { id: true, type: true, dropInSessionId: true, quantity: true } },
            sessions: {
              where: { scheduledAt: { gte: new Date() } },
              orderBy: { scheduledAt: 'asc' },
              // The slot carries this session's own cap for a drop-in class.
              select: { id: true, scheduledAt: true, packageSessionSlot: { select: { capacity: true } } },
            },
          },
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
          select: {
            id: true, name: true, kind: true, priceCents: true, salePriceCents: true,
            imageUrl: true, category: true, active: true,
            // Active options only: this picker RECORDS a handover, and handing
            // over a size the trainer has retired isn't something to make easy.
            variants: {
              where: { active: true },
              orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
              select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.productRequest.findMany({
      where: { clientId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, note: true,
        variant: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, kind: true, imageUrl: true } },
      },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: access.trainerId },
      select: { baseLat: true, baseLng: true },
    }),
    // Recent practice logs across this client's homework tasks (newest first).
    prisma.trainingLog.findMany({
      where: { task: { clientId } },
      orderBy: { loggedAt: 'desc' },
      take: 30,
      select: {
        id: true, loggedAt: true, note: true, repsDone: true, rating: true,
        imageUrls: true, videoUrl: true, trainerComment: true,
        task: { select: { id: true, title: true } },
      },
    }),
  ])

  if (!client) notFound()

  // Communication records for this client — bulk emails received (with
  // open/click status) + the message/email thread — for the Communication tab.
  // Billing visibility gates the Invoices tab + the Overview unpaid-invoices card
  // (both read the new payment-agnostic Invoice model, fetched client-side).
  const [broadcastEmails, threadMessages, clientNotifications, trainerCtx] = await Promise.all([
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
    // Notifications sent TO this client — session notes, homework, reminders.
    // Sending session notes calls notifyClient(), which writes a Notification
    // and nothing else, so a trainer who sent notes saw no trace of it here:
    // the tab read only broadcasts and thread messages. Reported by a live
    // customer as "no comms show on clients who have had session notes sent".
    client.userId
      ? prisma.notification.findMany({
          where: { userId: client.userId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, title: true, body: true, createdAt: true, readAt: true },
        })
      : Promise.resolve([]),
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
    ...clientNotifications.map(n => ({
      id: `n-${n.id}`,
      kind: 'message' as const,
      // Always outbound: these are things WE sent them, never a reply.
      direction: 'outbound' as const,
      subject: n.title,
      // readAt is a real signal here — the client opened it in their app.
      status: (n.readAt ? 'OPENED' : 'SENT') as string | null,
      date: n.createdAt.toISOString(),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60)

  // Driving distance from the trainer's base to this client (guarded — null if
  // either has no location set, or Google is unreachable). Gated on the Route
  // planner add-on, which covers all address/distance calculations. One external
  // call after the batch, since it needs both the client's and base's coordinates.
  const clientAppEnabled = await hasAddon(access.trainerId, 'clientapp')
  // The Achievements tab was unconditional while every other optional tab on this
  // screen was gated, so a trainer who had switched achievements off still saw the
  // tab — and its empty panel — on every client. (Karl, 2026-07-30.)
  const achievementsEnabled = await hasAddon(access.trainerId, 'achievements')

  // Two aggregates that exist ONLY to put a true number on the profile's
  // summary tiles. Both are cheap single queries and both are gated by the same
  // flag that gates the tile they feed, so a trainer who can't see billing
  // doesn't pay for the invoice sum.
  //
  // The invoice scope is deliberately `trainerCtx.companyId` — exactly what
  // /api/trainer/finances/receivables uses — so the tile and the Invoices tab
  // can never quote different money.
  const [openInvoices, achievementsEarned] = await Promise.all([
    canViewBilling && trainerCtx
      ? prisma.invoice.findMany({
          where: { clientId, trainerId: trainerCtx.companyId, status: { in: ['UNPAID', 'PARTIAL'] } },
          select: { amountCents: true, amountPaidCents: true, currency: true },
        })
      : Promise.resolve([]),
    achievementsEnabled
      ? prisma.clientAchievement.count({ where: { clientId } })
      : Promise.resolve(0),
  ])
  // Never negative: an over-payment on one invoice must not cancel out what is
  // still owed on another.
  const owingCents = openInvoices.reduce((sum, i) => sum + Math.max(0, i.amountCents - i.amountPaidCents), 0)
  const owingCurrencies = new Set(openInvoices.map(i => i.currency))
  const invoiceSummary = {
    owingCents,
    currency: owingCurrencies.size === 1 ? [...owingCurrencies][0] : null,
    count: openInvoices.length,
  }

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

  const allDogs = mergeClientDogs(client.dog, client.dogs)
  const dogNames = Object.fromEntries(allDogs.map(d => [d.id, d.name]))

  // Whose photo the hero shows when a client has several dogs. The first LIVING
  // dog with one, in the order the rest of the screen lists them; a deceased
  // dog's photo only if that is genuinely all there is. Deliberately not a
  // carousel — the hero belongs to the PERSON, and something to swipe is not
  // something to read at a glance on an admin screen.
  const heroDog = allDogs.find(d => d.photoUrl && !d.deceasedAt) ?? allDogs.find(d => d.photoUrl) ?? null
  const heroPhoto = heroDog?.photoUrl ? { url: heroDog.photoUrl, dogName: heroDog.name } : null

  // Every per-client action — Edit, View as client, Re-invite, Assign consult,
  // Share, Delete — now lives ON the page, at the foot of the Overview tab,
  // instead of behind an "Actions" dropdown in the header. Built here because
  // the props come from this page's queries; rendered by ClientProfileTabs.
  //
  // Enrolling and assigning are forward-looking, so a deceased dog is dropped
  // from those pickers — unlike the Dogs tab below, which keeps showing them
  // (badged) so the owner's history survives.
  const livingDogs = allDogs.filter(d => !d.deceasedAt)
  const actionsPanel = (
    <ClientActionsPanel
      clientId={client.id}
      clientName={personLabel(client.user)}
      clientEmail={client.user.email ?? ''}
      canEdit={canEdit}
      isPrimaryTrainer={isPrimaryTrainer}
      clientAppEnabled={clientAppEnabled}
      needsInvite={!client.user.emailVerified}
      members={teamMembers.map(m => ({
        id: m.id,
        name: personLabel(m.user),
        role: m.role,
      }))}
      currentMembershipId={trainerCtx?.membershipId ?? null}
      dogs={livingDogs.map(d => ({ id: d.id, name: d.name }))}
      packages={packages.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        sessionType: p.sessionType,
        bufferMins: p.bufferMins,
        // When this offering runs. The assign modal places sessions inside it
        // first — the trainer gets the same slots a client would be offered.
        bookingWindow: packageBookingWindow(p),
      }))}
      classes={openClasses.map(c => {
        const cap = c.capacity ?? c.package.capacity ?? null
        // Same shared per-session-spaces helper the client wizard uses,
        // so both views agree on what's bookable.
        const spaces = classSessionSpaces(cap, c.enrollments)
        return {
          id: c.id,
          name: c.name,
          scheduleNote: c.scheduleNote,
          startLabel: c.startDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }),
          seatsLeft: cap == null ? null : Math.max(0, cap - spaces.fullSeats),
          allowDropIn: c.package.allowDropIn,
          sessions: c.sessions.map(s => ({
            id: s.id,
            label: s.scheduledAt.toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
            spacesLeft: spaces.spacesLeftFor(s.id, sessionCapacity(s.packageSessionSlot, c.capacity, c.package.capacity)),
          })),
        }
      })}
      availability={availabilitySlots.map(s => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        date: s.date ? s.date.toISOString().split('T')[0] : null,
        startTime: s.startTime,
        endTime: s.endTime,
      }))}
    />
  )

  return (
    <>
      {/* Header carries the client's name, the co-managed note and Back —
          nothing else. */}
      <PageHeader
        title={client.user.name ?? client.user.email ?? 'Client'}
        back={{ href: '/clients', label: 'Back to clients' }}
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
                name: personLabel(m.user),
                role: m.role,
              }))}
            />
          </div>
        )}
      </aside>
      <div className="min-w-0 flex-1">
      {/* Phone hero — the same shape as the client's own home screen (Karl,
          2026-08-06: "I really like the idea of the client look and feel of the
          profile where it has a big image"). It REPLACES the compact
          photo+name+status strip that used to sit here: same four facts, read
          in one glance instead of a 68px band.
          Phone only. On desktop the summary card in the aside already carries
          the photo, the name and the status, and two of those on one screen is
          the "nothing says the same thing twice" rule broken in the obvious way.
          Full-bleed: it escapes the page's own p-4. */}
      <ProfileHero
        // `w-auto` matters: ProfileHero's base is `w-full`, and a width:100%
        // block does NOT grow into a negative margin — it stays at the parent's
        // content width and just slides left, which is exactly the "photo is not
        // full width" Karl saw. With width:auto the -mx-4 makes it 100% + 32px,
        // i.e. edge to edge on a 394px phone, and no wider — so no sideways
        // page scroll. Square corners at every width it renders at (it is phone
        // only); rounding here would read as a card floating in a margin.
        className="lg:hidden w-auto -mx-4 -mt-4 h-[220px]"
        media={heroPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroPhoto.url} alt={heroPhoto.dogName} className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
        ) : null}
        // No photo is NOT an empty state here (Karl: "if there is no photo then
        // just a nice banner, we are talking to a human not a dog"). A trainer
        // must never be shown a prompt to upload someone else's dog's picture,
        // and a dog illustration standing in for a missing one would say the
        // screen is about the dog. It is about the person. So: the trainer's
        // accent, deepened toward slate-900 with color-mix so a pastel brand
        // still carries white text, and nothing drawn on it.
        title={client.user.name ?? client.user.email ?? 'Client'}
        chip={
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            client.status === 'ACTIVE' ? 'bg-emerald-400/95 text-emerald-950' : 'bg-white/85 text-slate-700'
          }`}>
            {client.status === 'ACTIVE' ? 'Active' : client.status === 'NEW' ? 'New' : 'Inactive'}
          </span>
        }
        subtitle={dogsLine(allDogs.map(d => ({ name: d.name, breed: d.breed })))}
      />
      <ClientProfileTabs
        clientId={client.id}
        clientName={personLabel(client.user)}
        canEdit={canEdit}
        actions={actionsPanel}
        communications={communications}
        canViewBilling={canViewBilling}
        showAchievements={achievementsEnabled}
        invoiceSummary={invoiceSummary}
        achievementsEarned={achievementsEarned}
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
          // Deliberately NOT filtered here — the Dogs tab keeps a deceased dog
          // visible (badged) so the owner's history survives.
          deceasedAt: d.deceasedAt ? d.deceasedAt.toISOString() : null,
        }))}
        products={products.map(p => ({
          id: p.id,
          name: p.name,
          kind: p.kind as 'PHYSICAL' | 'DIGITAL',
          priceCents: p.priceCents,
          salePriceCents: p.salePriceCents,
          imageUrl: p.imageUrl,
          category: p.category,
          active: p.active,
          variants: p.variants,
        }))}
        pendingProductRequests={pendingProductRequests.map(r => ({
          id: r.id,
          note: r.note,
          variant: r.variant,
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
          // Class sessions are titled "Session 2" on the run; on a client's
          // record the class name is what identifies them.
          title: s.className ? `${s.className} · ${s.title}` : s.title,
          scheduledAt: s.scheduledAt.toISOString(),
          durationMins: s.durationMins,
          sessionType: s.sessionType,
          status: s.status,
          invoicedAt: s.invoicedAt?.toISOString() ?? null,
          location: s.location,
          virtualLink: s.virtualLink,
          description: s.description,
          dogName: s.dogName,
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
        trainingLogs={trainingLogs.map(l => ({
          id: l.id,
          taskId: l.task.id,
          taskTitle: l.task.title,
          loggedAt: l.loggedAt.toISOString(),
          note: l.note,
          repsDone: l.repsDone,
          rating: l.rating,
          imageUrls: Array.isArray(l.imageUrls) ? (l.imageUrls as string[]) : [],
          videoUrl: l.videoUrl,
          trainerComment: l.trainerComment,
        }))}
      />
      </div>
      </div>
      </div>
    </>
  )
}
