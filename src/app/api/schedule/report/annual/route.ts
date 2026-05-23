import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export async function GET(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: {
      id: true,
      scheduleExtraFields: true,
      user: { select: { timezone: true } },
    },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const tz = trainerProfile.user.timezone
  const url = new URL(req.url)
  const yearParam = url.searchParams.get('year')
  const yearNow = Number(todayInTz(tz).slice(0, 4))
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : yearNow

  const yearStartStr = `${year}-01-01`
  const yearEndStr = `${year}-12-31`
  const startUtc = startOfDayInTz(yearStartStr, tz)
  const endUtc = endOfDayInTz(yearEndStr, tz)

  const extraFieldSelections = Array.isArray(trainerProfile.scheduleExtraFields)
    ? (trainerProfile.scheduleExtraFields as string[])
    : []
  const selectedCustomFieldIds = extraFieldSelections
    .filter(s => s.startsWith('custom:'))
    .map(s => s.slice('custom:'.length))

  const [sessions, customFields] = await Promise.all([
    prisma.trainingSession.findMany({
      where: {
        trainerId: trainerProfile.id,
        scheduledAt: { gte: startUtc, lte: endUtc },
      },
      include: {
        client: { include: { user: { select: { name: true, email: true } } } },
        dog: {
          select: {
            id: true,
            primaryFor: {
              take: 1,
              select: { id: true, user: { select: { name: true, email: true } } },
            },
          },
        },
        clientPackage: {
          select: {
            packageId: true,
            package: {
              select: {
                name: true,
                priceCents: true,
                specialPriceCents: true,
                sessionCount: true,
              },
            },
          },
        },
        buddies: { select: { id: true, clientId: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    selectedCustomFieldIds.length > 0
      ? prisma.customField.findMany({
          where: { trainerId: trainerProfile.id, id: { in: selectedCustomFieldIds } },
          orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.customField.findMany>>),
  ])

  // Resolve clientId per session and per-session revenue.
  const sessionClientId = new Map<string, string | null>()
  const clientIds = new Set<string>()
  const sessionRevenue = new Map<string, number>()
  for (const s of sessions) {
    const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
    sessionClientId.set(s.id, cid)
    if (cid) clientIds.add(cid)
    const pkg = s.clientPackage?.package
    sessionRevenue.set(
      s.id,
      pkg ? Math.round((pkg.specialPriceCents ?? pkg.priceCents ?? 0) / Math.max(1, pkg.sessionCount)) : 0,
    )
  }

  // Top-line totals.
  let completed = 0
  let upcoming = 0
  let inPerson = 0
  let virtual = 0
  let totalDurationMins = 0
  let buddyCount = 0
  let revenueCents = 0
  const uniqueClients = new Set<string>()
  const uniqueDogs = new Set<string>()
  const byPackage = new Map<string, { name: string; sessions: number; revenueCents: number }>()
  const byClient = new Map<string, { name: string; sessions: number; revenueCents: number }>()
  const byStatus = { UPCOMING: 0, COMPLETED: 0, COMMENTED: 0, INVOICED: 0 }

  // Per-month buckets keyed by 1..12 in trainer-local time.
  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_LABELS[i],
    sessions: 0,
    revenueCents: 0,
    uniqueClients: 0,
  }))
  const monthClientSets: Set<string>[] = Array.from({ length: 12 }, () => new Set<string>())

  for (const s of sessions) {
    const rev = sessionRevenue.get(s.id) ?? 0
    revenueCents += rev
    totalDurationMins += s.durationMins
    if (s.sessionType === 'IN_PERSON') inPerson++; else virtual++
    if (s.status === 'UPCOMING') upcoming++; else completed++
    byStatus[s.status as keyof typeof byStatus]++

    const cid = sessionClientId.get(s.id) ?? null
    if (cid) uniqueClients.add(cid)
    if (s.dogId) uniqueDogs.add(s.dogId)

    if (s.clientPackage?.package) {
      const key = s.clientPackage.packageId
      const e = byPackage.get(key) ?? { name: s.clientPackage.package.name, sessions: 0, revenueCents: 0 }
      e.sessions++
      e.revenueCents += rev
      byPackage.set(key, e)
    } else {
      const e = byPackage.get('__none__') ?? { name: 'Unassigned', sessions: 0, revenueCents: 0 }
      e.sessions++
      byPackage.set('__none__', e)
    }

    if (cid) {
      const u = s.client?.user ?? s.dog?.primaryFor[0]?.user
      const name = u?.name ?? u?.email ?? 'Unknown client'
      const e = byClient.get(cid) ?? { name, sessions: 0, revenueCents: 0 }
      e.sessions++
      e.revenueCents += rev
      byClient.set(cid, e)
    }

    buddyCount += s.buddies.length

    // Bucket into trainer-local month.
    const monthStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit' }).format(s.scheduledAt)
    const monthIdx = Number(monthStr) - 1
    if (monthIdx >= 0 && monthIdx < 12) {
      byMonth[monthIdx].sessions++
      byMonth[monthIdx].revenueCents += rev
      if (cid) monthClientSets[monthIdx].add(cid)
    }
  }
  for (let i = 0; i < 12; i++) byMonth[i].uniqueClients = monthClientSets[i].size

  // Custom-field breakdowns. DOG fields use the value tied to each client's primary dog.
  const valuesByClientField = new Map<string, string>()
  if (clientIds.size > 0 && customFields.length > 0) {
    const [primaryRows, valueRows] = await Promise.all([
      prisma.clientProfile.findMany({
        where: { id: { in: Array.from(clientIds) } },
        select: { id: true, dogId: true },
      }),
      prisma.customFieldValue.findMany({
        where: {
          fieldId: { in: customFields.map(f => f.id) },
          clientId: { in: Array.from(clientIds) },
        },
        select: { fieldId: true, clientId: true, dogId: true, value: true },
      }),
    ])
    const primaryDogByClient = new Map(primaryRows.map(r => [r.id, r.dogId] as const))
    for (const v of valueRows) {
      const meta = customFields.find(f => f.id === v.fieldId)
      if (!meta) continue
      if (meta.appliesTo === 'DOG') {
        const primary = primaryDogByClient.get(v.clientId) ?? null
        if (v.dogId && primary && v.dogId !== primary) continue
      }
      valuesByClientField.set(`${v.fieldId}|${v.clientId}`, v.value)
    }
  }

  const orderedFields = selectedCustomFieldIds
    .map(id => customFields.find(f => f.id === id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))

  const customBreakdowns = orderedFields.map(field => {
    const buckets = new Map<string, { sessions: number; revenueCents: number }>()
    for (const s of sessions) {
      const cid = sessionClientId.get(s.id) ?? null
      const value = (cid && valuesByClientField.get(`${field.id}|${cid}`)) || '—'
      const e = buckets.get(value) ?? { sessions: 0, revenueCents: 0 }
      e.sessions++
      e.revenueCents += sessionRevenue.get(s.id) ?? 0
      buckets.set(value, e)
    }
    const list = Array.from(buckets.entries())
      .map(([value, v]) => ({ value, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents || b.sessions - a.sessions)
    return {
      id: field.id,
      label: field.label,
      type: field.type,
      appliesTo: field.appliesTo,
      buckets: list,
    }
  })

  const monthsWithData = byMonth.filter(m => m.sessions > 0).length
  const bestMonth = byMonth.reduce((best, m) => (m.revenueCents > best.revenueCents ? m : best), byMonth[0])

  return NextResponse.json({
    year,
    timezone: tz,
    totals: {
      sessions: sessions.length,
      upcoming,
      completed,
      uniqueClients: uniqueClients.size,
      uniqueDogs: uniqueDogs.size,
      revenueCents,
      hoursScheduled: Math.round((totalDurationMins / 60) * 10) / 10,
      avgDurationMins: sessions.length > 0 ? Math.round(totalDurationMins / sessions.length) : 0,
      inPerson,
      virtual,
      buddyCount,
      byStatus,
      avgRevenuePerMonthCents: monthsWithData > 0 ? Math.round(revenueCents / monthsWithData) : 0,
      bestMonthLabel: bestMonth.label,
      bestMonthRevenueCents: bestMonth.revenueCents,
    },
    byMonth,
    byPackage: Array.from(byPackage.values()).sort((a, b) => b.revenueCents - a.revenueCents || b.sessions - a.sessions),
    topClients: Array.from(byClient.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents || b.sessions - a.sessions)
      .slice(0, 10),
    customBreakdowns,
  })
}
