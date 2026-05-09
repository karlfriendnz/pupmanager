import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ScheduleView } from './schedule-view'
import { extendOngoingPackages } from '@/lib/extend-ongoing-packages'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Schedule' }

function getWeekBounds(dateStr: string): { weekStart: Date; weekEnd: Date } {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const weekStart = new Date(d)
  weekStart.setDate(d.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)
  return { weekStart, weekEnd }
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
  searchParams: Promise<{ date?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      googleCalendarConnected: true,
      scheduleStartHour: true,
      scheduleEndHour: true,
      scheduleDays: true,
      scheduleExtraFields: true,
    },
  })
  if (!trainerProfile) redirect('/login')

  // Top up forever-ongoing assignments before fetching sessions, so the
  // current view always includes any newly-generated bookings.
  await extendOngoingPackages(trainerProfile.id).catch(() => {})

  // Onboarding nudges (the indigo dot on the Hours button) only fire while
  // the trainer's still in the wizard. Once they're done, the schedule
  // page is just the schedule page.
  const fabState = await getOnboardingFabState(trainerProfile.id)
  const showHints = fabState.show

  const today = new Date().toISOString().split('T')[0]
  const sp = await searchParams
  const scheduleDaysArr = Array.isArray(trainerProfile.scheduleDays)
    ? trainerProfile.scheduleDays as number[]
    : [1, 2, 3, 4, 5, 6, 7]
  const selectedDate = sp.date ?? nextWorkingDay(today, scheduleDaysArr)

  const { weekStart, weekEnd } = getWeekBounds(selectedDate)

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

  // Single parallel fan-out instead of three sequential awaits.
  const [customFields, sessions, availabilitySlots, clients, packages] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId: trainerProfile.id },
      select: { id: true, label: true, appliesTo: true },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
    }),
    prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        scheduledAt: { gte: weekStart, lte: weekEnd },
        // Skip sessions orphaned by client deletion — clientId is SetNull
        // when the client is removed, so the session row sticks around but
        // has nobody to attribute it to.
        clientId: { not: null },
      },
      include: {
        dog: {
          select: {
            name: true,
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
  ])

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

  return (
    <ScheduleView
      sessions={sessions.map(s => ({
        ...s,
        scheduledAt: s.scheduledAt.toISOString(),
        packageColor: (s.clientPackage?.package?.color ?? null) as 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan' | null,
      }))}
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
      googleCalendarConnected={trainerProfile.googleCalendarConnected}
      scheduleStartHour={trainerProfile.scheduleStartHour}
      scheduleEndHour={trainerProfile.scheduleEndHour}
      scheduleDays={scheduleDaysArr}
      scheduleExtraFields={scheduleSelections}
      customFields={customFields}
      clientExtras={clientExtras}
      showHints={showHints}
    />
  )
}
