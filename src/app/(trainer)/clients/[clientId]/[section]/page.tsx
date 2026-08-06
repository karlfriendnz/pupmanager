import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { MessageSquare, PawPrint, Pencil } from 'lucide-react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { can } from '@/lib/permissions'
import { getTrainerContext } from '@/lib/membership'
import { getClientAccess } from '@/lib/trainer-access'
import { loadClientSessions } from '@/lib/client-sessions'
import { classSessionSpaces, sessionCapacity } from '@/lib/class-runs'
import { packageBookingWindow } from '@/lib/package-booking-window'
import { loadClientCommunications } from '@/lib/client-communications'
import { mergeClientDogs } from '@/lib/dogs'
import { routeDistance } from '@/lib/routing'
import { formatDate, personLabel } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import { EditScreen } from '@/components/shared/edit-screen'
import { ClientSectionChrome } from '../client-section-chrome'
import { ClientInvoicesScreen, ClientSessionsScreen } from '../client-section-actions'
import { ClientProductsSection } from '../client-products-section'
import { ClientNotesTab } from '../client-notes-tab'
import { ClientTrainingLogTab } from '../client-training-log-tab'
import { ClientInvoicesTab } from '../client-invoices'
import { ClientAchievementsPanel } from '../client-achievements-panel'
import {
  ClientCommsSection, ClientDetailsSection, ClientDogsSection, ClientSessionsSection,
} from '../client-sections'
import { isClientSection, type ClientSection } from '../client-profile-types'

/**
 * One section of a client's record, as its own page.
 *
 * These were tabs on the profile. Tapping one swapped content *below* the hero
 * and below the tile grid, so on a phone nothing appeared to happen (Karl,
 * 2026-08-06: "these need to open new pages there is no way people will see the
 * change at the bottom").
 *
 * ONE dynamic route rather than eight folders, because the interesting part is
 * not the routing — it is that each section fetches ONLY its own data. As tabs
 * they all loaded on every visit to a client, whether or not anyone looked:
 * every custom field, every custom field value, thirty practice logs, fifty
 * broadcasts, fifty messages, fifty notifications and a Google Directions call.
 * The switch below is what makes that per-section.
 *
 * `[section]` sits alongside the static `edit/` folder; Next resolves a literal
 * segment before a dynamic one, so /clients/x/edit is untouched.
 *
 * NO HERO here (Karl: "when you go to new page it should not have the image of
 * dog anymore"). The photo is what makes the PROFILE feel like a person; on a
 * section page it is 300px of decoration between the trainer and the notes they
 * came to read, on all eight pages. Whose record this is comes from the line
 * under the title instead.
 */

const SECTION_TITLE: Record<ClientSection, string> = {
  sessions: 'Sessions',
  products: 'Products',
  training: 'Training log',
  dogs: 'Dogs',
  communication: 'Comms',
  notes: 'Notes',
  invoices: 'Invoices',
  achievements: 'Achievements',
  details: 'Details',
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params
  return { title: isClientSection(section) ? SECTION_TITLE[section] : 'Client' }
}

export default async function ClientSectionPage({
  params,
}: {
  params: Promise<{ clientId: string; section: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId, section } = await params
  if (!isClientSection(section)) notFound()

  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()
  const { client: clientAccess, canEdit } = access

  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true, status: true, notes: true, phone: true, addressLine: true,
      addressLat: true, addressLng: true, dogId: true, trainerId: true,
      user: { select: { name: true, email: true, createdAt: true } },
      dog: true,
      dogs: true,
    },
  })
  if (!client) notFound()

  const clientName = personLabel(client.user)
  const allDogs = mergeClientDogs(client.dog, client.dogs)
  const dogLine = allDogs.map(d => d.name).join(', ')

  // ── Permissions travel with the route ────────────────────────────────────
  //
  // These three sections were hidden by not rendering their TAB. A tab that
  // isn't drawn is not a guard — the moment a section has a URL, anyone who can
  // reach the client can type it. Each is now checked here, server-side, before
  // anything is fetched, and a failure is a 404 rather than a 403 so the URL
  // doesn't confirm what exists.
  const trainerCtx = await getTrainerContext()
  if (section === 'invoices') {
    if (!trainerCtx || !can('billing.view', trainerCtx.role, trainerCtx.permissions)) notFound()
  }
  if (section === 'achievements') {
    if (!await hasAddon(access.trainerId, 'achievements')) notFound()
  }
  if (section === 'communication') {
    const clientAppEnabled = await hasAddon(access.trainerId, 'clientapp')
    if (!clientAppEnabled && !client.user.email) notFound()
  }

  // Whose record this is, INSIDE the header rather than in a strip under it:
  //
  //   ←   Details
  //       karl · Sammy
  //
  // It was its own full-width band, which cost about 120px of a phone before a
  // single detail (Karl, 2026-08-06: "i think we should tighten this up"). One
  // band, one hairline. The same line on all eight pages so they read as
  // siblings — and no trailing separator when there is no dog.
  const identity = dogLine ? `${clientName} · ${dogLine}` : clientName

  const shell = (body: React.ReactNode) => (
    <>
      <PageHeader
        title={SECTION_TITLE[section]}
        subtitle={identity}
        back={{ href: `/clients/${clientId}`, label: `Back to ${clientName}` }}
      />
      <ClientSectionChrome />
      <div className="p-4 md:p-8 w-full max-w-5xl xl:max-w-7xl mx-auto">
        {body}
      </div>
    </>
  )

  switch (section) {
    case 'sessions': {
      // 1:1 AND class sessions — a class session belongs to the run, not the
      // client, so a client who only does classes would otherwise read empty.
      //
      // Plus everything the "Book a session" bar needs. Karl asked for the
      // CLIENT's own booking wizard here (my-availability/booking-wizard.tsx).
      // It is not a prop away: that flow is driven by "who am I" — it POSTs to
      // /api/my/booking-gate, /api/my/booking-hold, /api/my/self-book,
      // /api/my/classes/:id/enroll and /api/my/waitlist, and every one of those
      // authorises the CALLING CLIENT via getActiveClient(). Making a trainer
      // able to drive it on someone's behalf needs a trainer-side twin of each
      // route (loosening the client routes to accept a client id in the body is
      // the exact shape of a cross-tenant hole), the wizard parameterised on a
      // client rather than a session, and the pre-booking form gate skipped for
      // the trainer. That is a piece of work, not a prop, so the bar opens the
      // trainer's EXISTING booking flow — the same AssignPackageButton the
      // profile's Assign action opens. One path that creates sessions, not two.
      const [sessions, packages, openClasses, availability, members] = await Promise.all([
        loadClientSessions(clientId),
        canEdit
          ? prisma.package.findMany({
              where: { trainerId: access.trainerId, isGroup: false, isSample: false },
              orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
            })
          : Promise.resolve([]),
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
        canEdit
          ? prisma.trainerMembership.findMany({
              where: { companyId: clientAccess.trainerId },
              select: { id: true, role: true, user: { select: { name: true, email: true } } },
              orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
            })
          : Promise.resolve([]),
      ])
      return shell(
        <ClientSessionsScreen
          canAssign={canEdit && (packages.length > 0 || openClasses.length > 0)}
          assign={{
            clientId,
            // Forward-looking, so a deceased dog is dropped from the picker.
            dogs: allDogs.filter(d => !d.deceasedAt).map(d => ({ id: d.id, name: d.name })),
            currentMembershipId: trainerCtx?.membershipId ?? null,
            members: members.map(m => ({ id: m.id, name: personLabel(m.user), role: m.role })),
            packages: packages.map(p => ({
              id: p.id, name: p.name, description: p.description,
              sessionCount: p.sessionCount, weeksBetween: p.weeksBetween,
              durationMins: p.durationMins, sessionType: p.sessionType, bufferMins: p.bufferMins,
              // The per-offering booking window GUIDES the trainer to the times
              // a client would be offered; it does not block them.
              bookingWindow: packageBookingWindow(p),
            })),
            classes: openClasses.map(c => {
              const cap = c.capacity ?? c.package.capacity ?? null
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
            }),
            availability: availability.map(s => ({
              id: s.id,
              dayOfWeek: s.dayOfWeek,
              date: s.date ? s.date.toISOString().split('T')[0] : null,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          }}
        >
        <ClientSessionsSection
          sessions={sessions.map(s => ({
            id: s.id,
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
        </ClientSessionsScreen>
      )
    }

    case 'training': {
      const logs = await prisma.trainingLog.findMany({
        where: { task: { clientId } },
        orderBy: { loggedAt: 'desc' },
        take: 30,
        select: {
          id: true, loggedAt: true, note: true, repsDone: true, rating: true,
          imageUrls: true, videoUrl: true, trainerComment: true,
          task: { select: { id: true, title: true } },
        },
      })
      return shell(
        <ClientTrainingLogTab
          logs={logs.map(l => ({
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
      )
    }

    case 'dogs': {
      const [fields, values] = await Promise.all([
        prisma.customField.findMany({
          where: { trainerId: clientAccess.trainerId, appliesTo: 'DOG' },
          orderBy: { order: 'asc' },
        }),
        prisma.customFieldValue.findMany({ where: { clientId } }),
      ])
      // Add + edit both go to the trainer's EXISTING dog editor — the Dogs tab
      // of /clients/:id/edit, which already creates and updates dogs through
      // trainer-authorised routes. Deliberately NOT the client's own
      // my-dogs-manager: it writes through /api/my/dogs, which authorises the
      // CALLING CLIENT via getActiveClient(), and widening that to take a
      // client id from the body is the exact shape of a cross-tenant hole.
      // A third dog form was never on the table.
      return shell(
        <EditScreen
          primary={canEdit
            ? { label: 'Add a dog', icon: <PawPrint className="h-4 w-4" strokeWidth={1.75} />, href: `/clients/${clientId}/edit` }
            : { label: 'Back to profile', href: `/clients/${clientId}` }}
        >
        <ClientDogsSection
          // Deceased dogs stay VISIBLE here (badged) — the owner's history is
          // theirs to keep. They're dropped only from forward-looking pickers.
          dogs={allDogs.map(d => ({
            id: d.id, name: d.name, breed: d.breed, weight: d.weight,
            dob: d.dob ? d.dob.toISOString() : null,
            notes: d.notes,
            deceasedAt: d.deceasedAt ? d.deceasedAt.toISOString() : null,
          }))}
          dogFields={fields.map(f => ({
            id: f.id, label: f.label,
            appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
            category: f.category,
          }))}
          fieldValueMap={Object.fromEntries(values.map(v => [v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId, v.value]))}
          editHref={canEdit ? `/clients/${clientId}/edit` : null}
        />
        </EditScreen>
      )
    }

    case 'products': {
      // What to hand over next time, and what already has been. Both are
      // ProductRequest rows — PENDING and FULFILLED — so it is one query.
      const [requests, products] = await Promise.all([
        prisma.productRequest.findMany({
          where: { clientId, status: { in: ['PENDING', 'FULFILLED'] } },
          orderBy: [{ fulfilledAt: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true, note: true, status: true, fulfilledAt: true,
            variant: { select: { id: true, name: true } },
            product: { select: { id: true, name: true, kind: true, imageUrl: true } },
          },
        }),
        canEdit
          ? prisma.product.findMany({
              // No `active` filter — the trainer can add ANY of their products
              // to a client, even hidden ones; the picker badges them.
              where: { trainerId: clientAccess.trainerId },
              orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
              select: {
                id: true, name: true, kind: true, priceCents: true, salePriceCents: true,
                imageUrl: true, category: true, active: true,
                variants: {
                  where: { active: true },
                  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                  select: { id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true },
                },
              },
            })
          : Promise.resolve([]),
      ])
      const shape = (r: typeof requests[number]) => ({
        id: r.id,
        note: r.note,
        variant: r.variant,
        product: {
          id: r.product.id,
          name: r.product.name,
          kind: r.product.kind as 'PHYSICAL' | 'DIGITAL',
          imageUrl: r.product.imageUrl,
        },
      })
      return shell(
        <ClientProductsSection
          clientId={clientId}
          canEdit={canEdit}
          products={products.map(p => ({
            id: p.id, name: p.name, kind: p.kind as 'PHYSICAL' | 'DIGITAL',
            priceCents: p.priceCents, salePriceCents: p.salePriceCents,
            imageUrl: p.imageUrl, category: p.category, active: p.active,
            variants: p.variants,
          }))}
          pending={requests.filter(r => r.status === 'PENDING').map(shape)}
          handedOver={requests.filter(r => r.status === 'FULFILLED').map(r => ({
            ...shape(r),
            fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
          }))}
        />
      )
    }

    case 'communication':
      // The action is the thread the app already has — /messages?client=… —
      // not a second composer.
      return shell(
        <EditScreen
          primary={{
            label: 'Send a message',
            icon: <MessageSquare className="h-4 w-4" strokeWidth={1.75} />,
            href: `/messages?client=${clientId}`,
          }}
        >
          <ClientCommsSection clientId={clientId} communications={await loadClientCommunications(clientId, 60)} />
        </EditScreen>
      )

    // No pinned bar: the notes editor's own Save IS the action and it is the
    // only one there is. A second button saying the same thing 40px lower is
    // the rule Karl keeps catching us on.
    case 'notes':
      return shell(<ClientNotesTab clientId={clientId} initialNotes={client.notes} canEdit={canEdit} />)

    case 'invoices': {
      // The app's ONE sale composer, pre-targeted at this client. Same
      // component the global "+" and a session's "Take payment" open.
      const profile = await prisma.trainerProfile.findUnique({
        where: { id: access.trainerId },
        select: { payoutCurrency: true },
      })
      return shell(
        <ClientInvoicesScreen
          canEdit={canEdit}
          currency={profile?.payoutCurrency ?? 'nzd'}
          client={{
            id: clientId,
            name: clientName,
            dogName: allDogs[0]?.name ?? null,
            dogPhotoUrl: allDogs[0]?.photoUrl ?? null,
          }}
        >
          <ClientInvoicesTab clientId={clientId} />
        </ClientInvoicesScreen>
      )
    }

    // No pinned bar: every badge row carries its own Award button, so the
    // action is already beside the thing it acts on.
    case 'achievements':
      return shell(<ClientAchievementsPanel clientId={clientId} canEdit={canEdit} />)

    case 'details': {
      const [fields, values, baseProfile] = await Promise.all([
        prisma.customField.findMany({
          where: { trainerId: clientAccess.trainerId, appliesTo: { not: 'DOG' } },
          orderBy: { order: 'asc' },
        }),
        prisma.customFieldValue.findMany({ where: { clientId } }),
        prisma.trainerProfile.findUnique({
          where: { id: access.trainerId },
          select: { baseLat: true, baseLng: true },
        }),
      ])
      // The one external call on any of these pages, and it lives HERE rather
      // than on the profile — it's the only screen that prints the answer.
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
      return shell(
        <EditScreen
          primary={canEdit
            ? { label: 'Edit details', icon: <Pencil className="h-4 w-4" strokeWidth={1.75} />, href: `/clients/${clientId}/edit` }
            : { label: 'Back to profile', href: `/clients/${clientId}` }}
        >
        <ClientDetailsSection
          clientId={clientId}
          canEdit={canEdit}
          status={client.status}
          contact={{
            email: client.user.email,
            phone: client.phone,
            clientSince: formatDate(client.user.createdAt),
            address: client.addressLine,
            distanceFromBase,
          }}
          ownerFields={fields.map(f => ({
            id: f.id, label: f.label,
            appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
            category: f.category,
          }))}
          fieldValueMap={Object.fromEntries(values.map(v => [v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId, v.value]))}
        />
        </EditScreen>
      )
    }
  }
}
