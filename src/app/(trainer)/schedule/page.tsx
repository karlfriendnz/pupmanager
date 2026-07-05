import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, scopeForMember } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { allowedSlotTypes } from '@/lib/service-offerings'
import { ScheduleView } from './schedule-view'
import { GoogleCalendarNudge } from './google-calendar-nudge'
import { extendOngoingPackages } from '@/lib/extend-ongoing-packages'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { todayInTz, startOfDayInTz, endOfDayInTz } from '@/lib/timezone'
import { dateParts, ymdInTz } from '@/lib/utils'
import { buildPreviewBlocks } from '@/lib/booking-request-preview'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Schedule' }

// Mon–Sun window for the week containing `dateStr`, anchored to the
// trainer's timezone (not UTC / the Vercel host). Doing the weekday and
// week-start math in UTC keeps it host-tz-safe and handles month/year
// rollover; the resulting day boundaries are then converted to the UTC
// instants of midnight..23:59 *in the trainer's tz* so the session query
// matches what the dashboard's "Today's sessions" shows.
function getWeekBounds(dateStr: string, tz: string): { weekStart: Date; weekEnd: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  const toMonday = dow === 0 ? -6 : 1 - dow
  const mon = new Date(Date.UTC(y, m - 1, d + toMonday))
  const sun = new Date(Date.UTC(y, m - 1, d + toMonday + 6))
  const ymd = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  return {
    weekStart: startOfDayInTz(ymd(mon), tz),
    weekEnd: endOfDayInTz(ymd(sun), tz),
  }
}

// Walk forward from `dateStr` (YYYY-MM-DD) until we hit a day the trainer
// works. scheduleDays uses 1=Mon..7=Sun. Returns dateStr unchanged if the
// trainer has no working days configured.
function nextWorkingDay(dateStr: string, scheduleDays: number[]): string {
  if (scheduleDays.length === 0) return dateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12, 0, 0)
  for (let i = 0; i < 7; i++) {
    const js = date.getDay()
    const iso = js === 0 ? 7 : js
    if (scheduleDays.includes(iso)) {
      const yy = date.getFullYear()
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      const dd = String(date.getDate()).padStart(2, '0')
      return `${yy}-${mm}-${dd}`
    }
    date.setDate(date.getDate() + 1)
  }
  return dateStr
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; previewRequest?: string }>
}) {
  // Resolve via membership so invited trainers reach their company's schedule.
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  // Staff without schedule.viewAll only see their own assigned sessions.
  const memberScope = scopeForMember(ctx, 'schedule.viewAll')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      id: true,
      user: { select: { timezone: true } },
      googleCalendarConnected: true,
      scheduleStartHour: true,
      scheduleEndHour: true,
      scheduleMobileStartHour: true,
      scheduleMobileEndHour: true,
      scheduleDays: true,
      scheduleExtraFields: true,
      businessRoles: true,
    },
  })
  if (!trainerProfile) redirect('/login')

  // Trainers in this business, for the assigned-trainer picker (awaited in the
  // parallel batch below).
  const teamMembersP = prisma.trainerMembership.findMany({
    where: { companyId: trainerProfile.id },
    select: { id: true, role: true, title: true, user: { select: { name: true, email: true } } },
    orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
  })

  // Top up forever-ongoing assignments AFTER the response is sent, so it never
  // blocks the render. The generated bookings are weeks ahead (off the current
  // view), so showing them on the next load is fine — and this was the single
  // biggest cost on every schedule load.
  after(() => extendOngoingPackages(trainerProfile.id).catch(err => {
    console.error('[schedule] extendOngoingPackages failed', err)
  }))

  // Onboarding hint dot (awaited in the parallel batch below).
  const fabStateP = getOnboardingFabState(trainerProfile.id)

  // The trainer's configured timezone is the single source of truth for
  // every date/time the calendar shows — never the device or UTC.
  const tz = trainerProfile.user?.timezone ?? 'Pacific/Auckland'
  const today = todayInTz(tz)
  const sp = await searchParams
  const configuredDays = Array.isArray(trainerProfile.scheduleDays)
    ? trainerProfile.scheduleDays as number[]
    : [1, 2, 3, 4, 5, 6, 7]

  // Booking-request preview: a trainer clicked a pending self-booking request
  // to eyeball its proposed sessions on the grid before approving. Load it
  // (scoped + PENDING only), build ghost blocks from the proposed dates, and
  // focus the schedule on the first one. Read-only — no real sessions until
  // they confirm through the existing approve flow.
  const previewRow = sp.previewRequest
    ? await prisma.bookingRequest.findFirst({
        where: { id: sp.previewRequest, trainerId: trainerProfile.id, status: 'PENDING' },
        include: {
          package: { select: { name: true, sessionCount: true, durationMins: true } },
          client: { select: { user: { select: { name: true } } } },
        },
      })
    : null
  const previewBlocks = previewRow ? buildPreviewBlocks(previewRow.sessionDates, previewRow.package) : []
  const previewRequest = previewRow
    ? {
        id: previewRow.id,
        clientName: previewRow.client.user.name ?? 'Client',
        packageName: previewRow.package.name,
        blocks: previewBlocks,
      }
    : null

  // Focus the first proposed session's day (in the trainer's tz) when previewing
  // and no explicit date was passed; otherwise the usual next-working-day.
  const previewFirstDate = previewBlocks.length > 0 ? ymdInTz(previewBlocks[0].startIso, tz) : null
  const selectedDate = sp.date ?? previewFirstDate ?? nextWorkingDay(today, configuredDays)

  const { weekStart, weekEnd } = getWeekBounds(selectedDate, tz)

  // Auto-expand the visible weekdays when this week has sessions on a
  // day the trainer normally hides — so a Sunday-scheduled session
  // doesn't silently vanish from the calendar (the dashboard would
  // still show it via "Today's sessions" while the grid skipped the
  // whole column, which has burned trainers expecting WYSIWYG).
  // We don't mutate the trainer's persisted preference — the column
  // only appears for weeks that actually need it.
  const sessionsOnHiddenDaysP = prisma.trainingSession.findMany({
    where: {
      trainerId: trainerProfile.id,
      scheduledAt: { gte: weekStart, lte: weekEnd },
      // 1:1 sessions (clientId set) or class sessions (classRunId set).
      OR: [{ clientId: { not: null } }, { classRunId: { not: null } }],
      ...memberScope,
    },
    select: { scheduledAt: true },
  })

  // Inspect the trainer's selected schedule-extra fields up-front so we can
  // skip expensive lookups (session client compliance, custom values) when
  // nothing on the block depends on them.
  const scheduleSelections = Array.isArray(trainerProfile.scheduleExtraFields)
    ? trainerProfile.scheduleExtraFields as string[]
    : []
  const needsClientExtras = scheduleSelections.some(f =>
    f === 'email' || f === 'extraDogs' || f === 'compliance' || f.startsWith('custom:'),
  )
  const needsCompliance = scheduleSelections.includes('compliance')
  const wantedCustomIds = scheduleSelections
    .filter(c => c.startsWith('custom:'))
    .map(c => c.slice('custom:'.length))

  // The current member's imported Google "busy" times, server-rendered so the
  // grey strips are in the first paint of the schedule instead of a slow
  // client fetch after mount. Window matches what the client used (now → ~63d),
  // scoped to THIS member. Empty when the member isn't connected / no membership.
  const busyWindowStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const busyWindowEnd = new Date(Date.now() + 63 * 24 * 60 * 60 * 1000)
  const busyBlocksP = ctx.membershipId
    ? prisma.googleBusyBlock.findMany({
        where: { membershipId: ctx.membershipId, startsAt: { lt: busyWindowEnd }, endsAt: { gt: busyWindowStart } },
        select: { startsAt: true, endsAt: true, title: true },
        orderBy: { startsAt: 'asc' },
        take: 500,
      })
    : Promise.resolve([] as { startsAt: Date; endsAt: Date; title: string | null }[])

  // Single parallel fan-out — every independent query (incl. team members,
  // onboarding state, and the hidden-day probe) runs at once.
  const [teamMembers, fabState, sessionsOnHiddenDays, customFields, sessions, availabilitySlots, clients, packages, busyBlocks] = await Promise.all([
    teamMembersP,
    fabStateP,
    sessionsOnHiddenDaysP,
    prisma.customField.findMany({
      where: { trainerId: trainerProfile.id },
      select: { id: true, label: true, appliesTo: true },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
    }),
    prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        scheduledAt: { gte: weekStart, lte: weekEnd },
        // Include 1:1 sessions (clientId set) and class sessions (classRunId
        // set). Skip only sessions orphaned by client deletion — clientId is
        // SetNull when a client is removed, leaving a row with nobody to
        // attribute it to (and no classRun either).
        OR: [{ clientId: { not: null } }, { classRunId: { not: null } }],
        ...memberScope,
      },
      include: {
        assignedTrainer: { select: { id: true, title: true, user: { select: { name: true } } } },
        classRun: { select: { name: true } },
        dog: {
          select: {
            name: true,
            photoUrl: true,
            primaryFor: {
              take: 1,
              select: { id: true, user: { select: { name: true, email: true } } },
            },
          },
        },
        client: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
        clientPackage: {
          select: { package: { select: { color: true } } },
        },
        buddies: {
          select: {
            id: true,
            clientId: true,
            dogId: true,
            client: { select: { id: true, user: { select: { name: true, email: true } } } },
            dog: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.availabilitySlot.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
    prisma.clientProfile.findMany({
      where: { trainerId: trainerProfile.id, status: 'ACTIVE' },
      include: {
        user: { select: { name: true, email: true } },
        dog: { select: { id: true, name: true } },
        dogs: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.package.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    }),
    busyBlocksP,
  ])

  const showHints = fabState.show

  // Auto-expand visible weekdays when this week has sessions on a normally
  // hidden day, so they don't silently vanish from the grid.
  const hiddenDaysWithSessions = new Set<number>()
  for (const s of sessionsOnHiddenDays) {
    const js = dateParts(s.scheduledAt, tz).weekday // 0=Sun..6=Sat, trainer tz
    const iso = js === 0 ? 7 : js                    // schedule uses 1=Mon..7=Sun
    if (!configuredDays.includes(iso)) hiddenDaysWithSessions.add(iso)
  }
  const scheduleDaysArr = hiddenDaysWithSessions.size > 0
    ? [...configuredDays, ...hiddenDaysWithSessions].sort((a, b) => a - b)
    : configuredDays

  // Resolve a clientId for every session (direct link or via primary-dog
  // owner) so we can attach client-level extras used by the block renderer.
  const sessionClientIds = new Set<string>()
  for (const s of sessions) {
    const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
    if (cid) sessionClientIds.add(cid)
  }
  const sessionClientList = Array.from(sessionClientIds)

  // Validate custom-field IDs against the metadata we just loaded so we don't
  // query for stale selections.
  const selectedCustomIds = wantedCustomIds.filter(id => customFields.some(f => f.id === id))

  // Last fan-out: skip both queries entirely when nothing requires them.
  const [sessionClients, customValues] = await Promise.all([
    needsClientExtras && sessionClientList.length > 0
      ? prisma.clientProfile.findMany({
          where: { id: { in: sessionClientList } },
          select: {
            id: true,
            dogId: true,
            user: { select: { email: true } },
            dogs: { select: { name: true } },
            // Only join recent diary entries when compliance is actually shown.
            ...(needsCompliance && {
              diaryEntries: {
                where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
                select: { id: true, completion: { select: { id: true } } },
              },
            }),
          },
        })
      : Promise.resolve([] as Array<{
          id: string
          dogId: string | null
          user: { email: string }
          dogs: { name: string }[]
          diaryEntries?: { id: string; completion: { id: string } | null }[]
        }>),
    selectedCustomIds.length > 0 && sessionClientList.length > 0
      ? prisma.customFieldValue.findMany({
          where: { fieldId: { in: selectedCustomIds }, clientId: { in: sessionClientList } },
          select: { fieldId: true, clientId: true, dogId: true, value: true },
        })
      : Promise.resolve([] as Array<{ fieldId: string; clientId: string; dogId: string | null; value: string }>),
  ])

  const clientExtras: Record<string, {
    email: string
    extraDogNames: string[]
    taskCount: number
    completedCount: number
    customValues: Record<string, string>
  }> = {}
  for (const c of sessionClients) {
    // diaryEntries is only present when needsCompliance was true at query time.
    const diaryEntries = ((c as { diaryEntries?: { id: string; completion: { id: string } | null }[] }).diaryEntries) ?? []
    clientExtras[c.id] = {
      email: c.user.email,
      extraDogNames: c.dogs.map(d => d.name),
      taskCount: diaryEntries.length,
      completedCount: diaryEntries.filter(t => t.completion).length,
      customValues: {},
    }
  }
  // For DOG-applied fields, prefer the value tied to the client's primary dog.
  const primaryDogIdByClient = new Map(sessionClients.map(c => [c.id, c.dogId] as const))
  for (const v of customValues) {
    const meta = customFields.find(f => f.id === v.fieldId)
    if (meta?.appliesTo === 'DOG') {
      const primary = primaryDogIdByClient.get(v.clientId)
      if (v.dogId && primary && v.dogId !== primary) continue
    }
    if (clientExtras[v.clientId]) {
      clientExtras[v.clientId].customValues[v.fieldId] = v.value
    }
  }

  // Add-on nudge: only surface "connect Google Calendar" when this member
  // hasn't already connected. Cheap lookups, run in parallel.
  const [googleConn, googleAddonOn] = await Promise.all([
    ctx.membershipId
      ? prisma.googleCalendarConnection.findUnique({
          where: { membershipId: ctx.membershipId },
          select: { id: true },
        })
      : Promise.resolve(null),
    hasAddon(ctx.companyId, 'googlecalendar'),
  ])
  // On local dev, always surface it (even when connected/dismissed) so it's
  // easy to preview. In prod it only shows when this member hasn't connected.
  const isDevPreview = process.env.NODE_ENV === 'development'
  // Only nudge while NOT connected — connecting hides it (dev included; the old
  // `|| isDevPreview` forced it on even after connecting, which was confusing).
  const showGoogleNudge = !googleConn

  return (
    <>
    <ScheduleView
      sessions={sessions.map(s => ({
        ...s,
        scheduledAt: s.scheduledAt.toISOString(),
        packageColor: (s.clientPackage?.package?.color ?? null) as 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan' | null,
        assignedTrainerName: s.assignedTrainer?.user?.name ?? s.assignedTrainer?.title ?? null,
      }))}
      members={teamMembers.map(m => ({
        id: m.id,
        name: m.user.name ?? m.user.email,
        role: m.role,
      }))}
      initialBusyBlocks={busyBlocks.map(b => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), title: b.title }))}
      availabilitySlots={availabilitySlots.map(s => ({
        ...s,
        date: s.date ? s.date.toISOString().split('T')[0] : null,
        firstDate: s.firstDate ? s.firstDate.toISOString().split('T')[0] : null,
      }))}
      clients={clients.map(c => ({
        id: c.id,
        name: c.user.name ?? c.user.email,
        dogs: [
          ...(c.dog ? [c.dog] : []),
          ...c.dogs,
        ],
      }))}
      packages={packages.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        sessionType: p.sessionType,
      }))}
      selectedDate={selectedDate}
      today={today}
      tz={tz}
      googleCalendarConnected={trainerProfile.googleCalendarConnected}
      scheduleStartHour={trainerProfile.scheduleStartHour}
      scheduleEndHour={trainerProfile.scheduleEndHour}
      scheduleMobileStartHour={trainerProfile.scheduleMobileStartHour}
      scheduleMobileEndHour={trainerProfile.scheduleMobileEndHour}
      scheduleDays={scheduleDaysArr}
      scheduleExtraFields={scheduleSelections}
      allowedSlotTypes={allowedSlotTypes(trainerProfile.businessRoles)}
      customFields={customFields}
      clientExtras={clientExtras}
      showHints={showHints}
      previewRequest={previewRequest}
    />
    {showGoogleNudge && (
      <GoogleCalendarNudge googleAddonOn={googleAddonOn} forceShow={isDevPreview} />
    )}
    </>
  )
}
