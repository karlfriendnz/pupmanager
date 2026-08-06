import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { can } from '@/lib/permissions'
import { getTrainerContext } from '@/lib/membership'
import { getClientAccess } from '@/lib/trainer-access'
import { loadClientSessions } from '@/lib/client-sessions'
import { loadClientCommunications } from '@/lib/client-communications'
import { mergeClientDogs } from '@/lib/dogs'
import { routeDistance } from '@/lib/routing'
import { formatDate, personLabel } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import { ClientSectionChrome } from '../client-section-chrome'
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

  const header = (
    <>
      <PageHeader
        title={SECTION_TITLE[section]}
        back={{ href: `/clients/${clientId}`, label: `Back to ${clientName}` }}
      />
      <ClientSectionChrome />
    </>
  )

  // Whose record this is, as one line of text under the title — the same line
  // on all eight pages so they read as siblings. It links back to the profile,
  // which gives the trainer a second way out that names where it goes.
  const identity = (
    <Link href={`/clients/${clientId}`} className="mb-4 block text-sm text-slate-500 hover:text-slate-700">
      <span className="font-medium text-slate-700">{clientName}</span>
      {dogLine && <> · {dogLine}</>}
    </Link>
  )

  const shell = (body: React.ReactNode) => (
    <>
      {header}
      <div className="p-4 md:p-8 w-full max-w-5xl xl:max-w-7xl mx-auto">
        {identity}
        {body}
      </div>
    </>
  )

  switch (section) {
    case 'sessions': {
      // 1:1 AND class sessions — a class session belongs to the run, not the
      // client, so a client who only does classes would otherwise read empty.
      const sessions = await loadClientSessions(clientId)
      return shell(
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
      return shell(
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
        />
      )
    }

    case 'communication':
      return shell(
        <ClientCommsSection clientId={clientId} communications={await loadClientCommunications(clientId, 60)} />
      )

    case 'notes':
      return shell(<ClientNotesTab clientId={clientId} initialNotes={client.notes} canEdit={canEdit} />)

    case 'invoices':
      return shell(<ClientInvoicesTab clientId={clientId} />)

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
      )
    }
  }
}
