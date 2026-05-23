import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, scopeForMember } from '@/lib/membership'
import { extendOngoingPackages } from '@/lib/extend-ongoing-packages'
import { startOfDayInTz, endOfDayInTz } from '@/lib/timezone'

// Returns the trainer's sessions and the client extras needed by the
// schedule blocks for a single week. Used by the schedule page to
// navigate weeks without a full server round-trip — the static data
// (clients, packages, custom fields, availability) stays in memory and
// only the per-week data is refetched.
//
// Week bounds are anchored to the trainer's timezone (not UTC / the
// Vercel host) so this matches the server page and the dashboard — see
// the matching helper in (trainer)/schedule/page.tsx.
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

export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId
  // Staff without schedule.viewAll see only their own assigned sessions.
  const memberScope = scopeForMember(ctx, 'schedule.viewAll')

  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'Missing date' }, { status: 400 })

  // Best-effort top up: keep the calendar full ahead of the visible week.
  await extendOngoingPackages(trainerId).catch(() => {})

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      scheduleExtraFields: true,
      user: { select: { timezone: true } },
    },
  })
  const tz = trainerProfile?.user?.timezone ?? 'Pacific/Auckland'
  const { weekStart, weekEnd } = getWeekBounds(date, tz)
  const scheduleSelections = Array.isArray(trainerProfile?.scheduleExtraFields)
    ? trainerProfile.scheduleExtraFields as string[]
    : []
  const needsClientExtras = scheduleSelections.some(f =>
    f === 'email' || f === 'extraDogs' || f === 'compliance' || f.startsWith('custom:'),
  )
  const needsCompliance = scheduleSelections.includes('compliance')

  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { gte: weekStart, lte: weekEnd },
      ...memberScope,
    },
    include: {
      assignedTrainer: { select: { id: true, title: true, user: { select: { name: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: {
            take: 1,
            select: { id: true, user: { select: { name: true, email: true } } },
          },
        },
      },
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      clientPackage: { select: { package: { select: { color: true } } } },
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
  })

  // Resolve the client per session and build clientExtras the same way the
  // server page does, so the renderer can render extras the trainer chose.
  const clientIds = new Set<string>()
  for (const s of sessions) {
    const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
    if (cid) clientIds.add(cid)
  }
  const clientList = Array.from(clientIds)

  const wantedCustomIds = scheduleSelections
    .filter(c => c.startsWith('custom:'))
    .map(c => c.slice('custom:'.length))

  const [sessionClients, customFields, customValues] = await Promise.all([
    needsClientExtras && clientList.length > 0
      ? prisma.clientProfile.findMany({
          where: { id: { in: clientList } },
          select: {
            id: true,
            dogId: true,
            user: { select: { email: true } },
            dogs: { select: { name: true } },
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
    wantedCustomIds.length > 0
      ? prisma.customField.findMany({
          where: { trainerId, id: { in: wantedCustomIds } },
          select: { id: true, appliesTo: true },
        })
      : Promise.resolve([] as Array<{ id: string; appliesTo: string }>),
    wantedCustomIds.length > 0 && clientList.length > 0
      ? prisma.customFieldValue.findMany({
          where: { fieldId: { in: wantedCustomIds }, clientId: { in: clientList } },
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
    const diaryEntries = ((c as { diaryEntries?: { id: string; completion: { id: string } | null }[] }).diaryEntries) ?? []
    clientExtras[c.id] = {
      email: c.user.email,
      extraDogNames: c.dogs.map(d => d.name),
      taskCount: diaryEntries.length,
      completedCount: diaryEntries.filter(t => t.completion).length,
      customValues: {},
    }
  }
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

  return NextResponse.json({
    sessions: sessions.map(s => ({
      ...s,
      scheduledAt: s.scheduledAt.toISOString(),
      packageColor: s.clientPackage?.package?.color ?? null,
      assignedTrainerName: s.assignedTrainer?.user?.name ?? s.assignedTrainer?.title ?? null,
    })),
    clientExtras,
  })
}
