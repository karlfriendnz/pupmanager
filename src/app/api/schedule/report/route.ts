import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function dayOfWeekIso(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function mondayOf(dateStr: string): string {
  const dow = dayOfWeekIso(dateStr)
  return addDayStr(dateStr, -(dow - 1))
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      scheduleExtraFields: true,
      user: { select: { timezone: true } },
    },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const tz = trainerProfile.user.timezone

  // The trainer's chosen "extra fields" in /schedule view settings double as
  // the picker for which custom fields the report breaks revenue down by —
  // anything they didn't pick there stays out of this report.
  const extraFieldSelections = Array.isArray(trainerProfile.scheduleExtraFields)
    ? (trainerProfile.scheduleExtraFields as string[])
    : []
  const selectedCustomFieldIds = extraFieldSelections
    .filter(s => s.startsWith('custom:'))
    .map(s => s.slice('custom:'.length))
  const url = new URL(req.url)
  const rawWeekStart = url.searchParams.get('weekStart')
  const weekStart = rawWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(rawWeekStart)
    ? mondayOf(rawWeekStart)
    : mondayOf(todayInTz(tz))
  const weekEnd = addDayStr(weekStart, 6)

  const startUtc = startOfDayInTz(weekStart, tz)
  const endUtc = endOfDayInTz(weekEnd, tz)

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
                color: true,
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

  // Resolve clientId per session (direct link or via the dog's primary owner).
  const sessionClientId = new Map<string, string | null>()
  const clientIds = new Set<string>()
  for (const s of sessions) {
    const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
    sessionClientId.set(s.id, cid)
    if (cid) clientIds.add(cid)
  }

  // Per-session revenue from the package allocation: prefer the special price,
  // fall back to list price, divide across sessionCount. Sessions without a
  // package contribute nothing to revenue.
  const sessionRevenue = new Map<string, number>()
  for (const s of sessions) {
    const pkg = s.clientPackage?.package
    if (pkg) {
      const price = pkg.specialPriceCents ?? pkg.priceCents ?? 0
      sessionRevenue.set(s.id, Math.round(price / Math.max(1, pkg.sessionCount)))
    } else {
      sessionRevenue.set(s.id, 0)
    }
  }

  // Top-level totals.
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

  for (const s of sessions) {
    const rev = sessionRevenue.get(s.id) ?? 0
    revenueCents += rev
    totalDurationMins += s.durationMins
    if (s.sessionType === 'IN_PERSON') inPerson++
    else virtual++
    if (s.status === 'UPCOMING') upcoming++
    else completed++
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
  }

  // Custom-field breakdowns. We attribute each session to its client's value
  // for the field; DOG fields use the value tied to the client's primary dog.
  let primaryDogByClient: Map<string, string | null> | null = null
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
    primaryDogByClient = new Map(primaryRows.map(r => [r.id, r.dogId] as const))
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

  // Preserve the trainer's selection order from scheduleExtraFields so the
  // report mirrors how they ordered the fields on the calendar blocks.
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
      category: field.category,
      buckets: list,
    }
  })

  return NextResponse.json({
    weekStart,
    weekEnd,
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
    },
    byPackage: Array.from(byPackage.values())
      .sort((a, b) => b.revenueCents - a.revenueCents || b.sessions - a.sessions),
    topClients: Array.from(byClient.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.sessions - a.sessions || b.revenueCents - a.revenueCents)
      .slice(0, 8),
    customBreakdowns,
  })
}
