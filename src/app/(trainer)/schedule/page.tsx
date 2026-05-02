import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ScheduleView } from './schedule-view'
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
  if (!trainerProfile) redirect('/onboarding')

  // Picker now mirrors the trainer's CustomField list. Load metadata so the
  // schedule-settings popover can offer the same custom fields available on
  // the /clients column selector.
  const customFields = await prisma.customField.findMany({
    where: { trainerId: trainerProfile.id },
    select: { id: true, label: true, appliesTo: true },
    orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
  })

  const today = new Date().toISOString().split('T')[0]
  const sp = await searchParams
  const selectedDate = sp.date ?? today

  const { weekStart, weekEnd } = getWeekBounds(selectedDate)

  const [sessions, availabilitySlots, clients, packages] = await Promise.all([
    prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        scheduledAt: { gte: weekStart, lte: weekEnd },
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
  // owner) so we can attach client-level extras (email, dogs, compliance,
  // custom values) used by the block renderer.
  const sessionClientIds = new Set<string>()
  for (const s of sessions) {
    const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
    if (cid) sessionClientIds.add(cid)
  }
  const sessionClientList = Array.from(sessionClientIds)

  const sessionClients = sessionClientList.length > 0
    ? await prisma.clientProfile.findMany({
        where: { id: { in: sessionClientList } },
        select: {
          id: true,
          dogId: true,
          user: { select: { email: true } },
          dogs: { select: { name: true } },
          diaryEntries: {
            where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
            select: { id: true, completion: { select: { id: true } } },
          },
        },
      })
    : []

  // Load CustomFieldValue rows only for fields that are actually selected
  // on the schedule block — keeps the payload tight.
  const scheduleSelections = Array.isArray(trainerProfile.scheduleExtraFields)
    ? trainerProfile.scheduleExtraFields as string[]
    : []
  const selectedCustomIds = scheduleSelections
    .filter(c => c.startsWith('custom:'))
    .map(c => c.slice('custom:'.length))
    .filter(id => customFields.some(f => f.id === id))
  const customValues = (selectedCustomIds.length > 0 && sessionClientList.length > 0)
    ? await prisma.customFieldValue.findMany({
        where: { fieldId: { in: selectedCustomIds }, clientId: { in: sessionClientList } },
        select: { fieldId: true, clientId: true, dogId: true, value: true },
      })
    : []

  const clientExtras: Record<string, {
    email: string
    extraDogNames: string[]
    taskCount: number
    completedCount: number
    customValues: Record<string, string>
  }> = {}
  for (const c of sessionClients) {
    clientExtras[c.id] = {
      email: c.user.email,
      extraDogNames: c.dogs.map(d => d.name),
      taskCount: c.diaryEntries.length,
      completedCount: c.diaryEntries.filter(t => t.completion).length,
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
      scheduleDays={Array.isArray(trainerProfile.scheduleDays) ? trainerProfile.scheduleDays as number[] : [1, 2, 3, 4, 5, 6, 7]}
      scheduleExtraFields={scheduleSelections}
      customFields={customFields}
      clientExtras={clientExtras}
    />
  )
}
