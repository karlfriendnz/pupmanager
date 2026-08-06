import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadClientSessions } from '@/lib/client-sessions'
import { loadClientCommunications } from '@/lib/client-communications'
import { hasAddon } from '@/lib/billing'
import { classSessionSpaces, sessionCapacity } from '@/lib/class-runs'
import { getClientAccess } from '@/lib/trainer-access'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { routeDistance } from '@/lib/routing'
import { mergeClientDogs } from '@/lib/dogs'
import { formatDate, personLabel } from '@/lib/utils'
import { richTextToPlain } from '@/lib/rich-text'
import { dogsLine } from '@/lib/client-profile-summary'
import { ClientProfileView } from './client-profile-view'
import { ClientSummaryCard } from './client-summary-card'
import { ClientActionsPanel } from './client-actions-panel'
import { AssignedTrainerControl } from './assigned-trainer-control'
import { LEGACY_TAB_TO_SECTION } from './client-profile-types'
import { PageHeader } from '@/components/shared/page-header'
import { ProfileHero } from '@/components/shared/profile-hero'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import { packageBookingWindow } from '@/lib/package-booking-window'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Client profile' }

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ tab?: string; sessionId?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId } = await params
  const sp = await searchParams

  // Every tab is a page now. The old `?tab=` links are in bookmarks, in emails
  // and in this app's own screens, so they land where they always meant to
  // rather than silently opening the profile. `?tab=overview` has nowhere to go
  // and needs none — the profile IS the overview.
  const legacySection = sp.tab ? LEGACY_TAB_TO_SECTION[sp.tab] : undefined
  if (legacySection) redirect(`/clients/${clientId}/${legacySection}`)
  // Likewise `?sessionId=` — the modal that opens it lives on the Sessions page.
  if (sp.sessionId) redirect(`/clients/${clientId}/sessions?sessionId=${encodeURIComponent(sp.sessionId)}`)

  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()

  const { client: clientAccess, canEdit } = access
  const isPrimaryTrainer = clientAccess.trainerId === access.trainerId

  // One parallel fan-out.
  //
  // Deliberately SMALLER than it was. Every section of a client is its own page
  // now (see `[section]/page.tsx`), so this screen no longer loads custom
  // fields, custom field values, thirty practice logs, fifty broadcasts, fifty
  // messages or fifty notifications on the chance that the trainer taps a tab.
  // The content cards went the same way (Karl: "these things should be on the
  // pages"), so the shop catalogue and the pending-request rows went with them.
  // What's left is what the summary tiles print, plus what the ⋯ actions and
  // the desktop summary card need.
  const [
    client,
    trainingSessions,
    packages,
    openClasses,
    availabilitySlots,
    teamMembers,
    baseProfile,
    trainingLogCount,
    pendingProductCount,
    communications,
  ] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        user: { select: { name: true, email: true, emailVerified: true, createdAt: true } },
        dog: true,
        dogs: true,
      },
    }),
    // 1:1 AND class sessions. A class session belongs to the run, not the
    // client, so the old query returned nothing for someone who only does
    // classes — their record read "Sessions 0" while their own app listed them.
    loadClientSessions(clientId),
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
    prisma.trainerProfile.findUnique({
      where: { id: access.trainerId },
      select: { baseLat: true, baseLng: true },
    }),
    // COUNTED, not loaded: these tiles only ever print the number, and the
    // lists belong to /clients/:id/training and /clients/:id/products.
    prisma.trainingLog.count({ where: { task: { clientId } } }),
    prisma.productRequest.count({ where: { clientId, status: 'PENDING' } }),
    // The newest ONE — all the Comms tile prints is how long ago it was.
    loadClientCommunications(clientId, 1),
  ])

  if (!client) notFound()

  // Billing visibility gates the Invoices tile + page and the profile's
  // unpaid-invoices card (all read the payment-agnostic Invoice model).
  const trainerCtx = await getTrainerContext()
  const canViewBilling = !!trainerCtx && can('billing.view', trainerCtx.role, trainerCtx.permissions)

  const clientAppEnabled = await hasAddon(access.trainerId, 'clientapp')
  // The Achievements tab was unconditional while every other optional tab on this
  // screen was gated, so a trainer who had switched achievements off still saw the
  // tab — and its empty panel — on every client. (Karl, 2026-07-30.)
  const achievementsEnabled = await hasAddon(access.trainerId, 'achievements')

  // Two aggregates that exist ONLY to put a true number on the summary tiles.
  // Both are cheap and both are gated by the same flag that gates the tile they
  // feed, so a trainer who can't see billing doesn't pay for the invoice sum.
  //
  // The invoice scope is deliberately `trainerCtx.companyId` — exactly what
  // /api/trainer/finances/receivables uses — so the tile and the Invoices page
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

  // Driving distance from the trainer's base to this client, for the DESKTOP
  // summary card in the aside (the phone shows the hero instead, and the
  // Details page works it out for itself). Guarded — null if either has no
  // location set, or Google is unreachable — and gated on the Route planner
  // add-on, which covers all address/distance calculations.
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

  const allDogs = mergeClientDogs(client.dog, client.dogs)

  // Whose photo the hero shows when a client has several dogs. The first LIVING
  // dog with one, in the order the rest of the screen lists them; a deceased
  // dog's photo only if that is genuinely all there is. Deliberately not a
  // carousel — the hero belongs to the PERSON, and something to swipe is not
  // something to read at a glance on an admin screen.
  const heroDog = allDogs.find(d => d.photoUrl && !d.deceasedAt) ?? allDogs.find(d => d.photoUrl) ?? null
  const heroPhoto = heroDog?.photoUrl ? { url: heroDog.photoUrl, dogName: heroDog.name } : null

  // Comms only makes sense if there's a channel: the client app (in-app
  // messaging) is on, OR the client has an email. No app + no email → hide it.
  const showComms = clientAppEnabled || !!client.user.email

  // Enrolling and assigning are forward-looking, so a deceased dog is dropped
  // from those pickers — unlike the Dogs page, which keeps showing them
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

      {/* Summary sidebar + the profile. Desktop: the summary sticks to the
          left, the tiles and cards scroll on the right. Mobile: the hero
          replaces the sidebar entirely. */}
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
          It is also the PROFILE's alone — a section page opens straight into
          its content. */}
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
      <ClientProfileView
        clientId={client.id}
        actions={actionsPanel}
        canViewBilling={canViewBilling}
        invoiceSummary={invoiceSummary}
        showAchievements={achievementsEnabled}
        achievementsEarned={achievementsEarned}
        showComms={showComms}
        communications={communications}
        trainingLogCount={trainingLogCount}
        pendingProductCount={pendingProductCount}
        notesPreview={client.notes ? richTextToPlain(client.notes) : null}
        clientSince={formatDate(client.user.createdAt)}
        dogs={allDogs.map(d => ({
          id: d.id,
          name: d.name,
          breed: d.breed,
          weight: d.weight,
          dob: d.dob ? d.dob.toISOString() : null,
          notes: d.notes,
          deceasedAt: d.deceasedAt ? d.deceasedAt.toISOString() : null,
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
      />
      </div>
      </div>
      </div>
    </>
  )
}
