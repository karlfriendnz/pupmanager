// Business-reports aggregation. One `getBusinessReports(trainerId)` call fans
// out every metric query in parallel and returns a fully-typed, chart-ready
// shape. The /reports page is a thin server component over this.
//
// All record counts include sample/demo records (no isSample filter) so the
// page is never mysteriously empty on a fresh or demo account.
import { prisma } from './prisma'

// ─── Shared bucketing helpers ────────────────────────────────────────────────

export interface MonthBucket {
  key: string // "2026-06"
  label: string // "Jun"
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Month buckets spanning [start, end] inclusive (oldest first).
function monthsBetween(start: Date, end: Date): MonthBucket[] {
  const out: MonthBucket[] = []
  const d = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (d <= last) {
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-NZ', { month: 'short' }),
    })
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

// Tally an array of dates into the supplied month buckets (counts per month).
function bucketCounts(dates: Date[], buckets: MonthBucket[]): number[] {
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  const counts = new Array(buckets.length).fill(0)
  for (const d of dates) {
    const i = idx.get(monthKey(d))
    if (i !== undefined) counts[i] += 1
  }
  return counts
}

// Mon-first weekday labels and tally (JS getDay: 0=Sun … 6=Sat).
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function weekdayCounts(dates: Date[]): number[] {
  const counts = new Array(7).fill(0)
  for (const d of dates) {
    const day = d.getDay() // 0=Sun
    counts[(day + 6) % 7] += 1 // shift so Mon=0
  }
  return counts
}

function ageGroup(dob: Date | null): string {
  if (!dob) return 'Unknown'
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (years < 1) return 'Puppy (<1y)'
  if (years < 3) return 'Junior (1–3y)'
  if (years < 7) return 'Adult (3–7y)'
  return 'Senior (7y+)'
}
const AGE_ORDER = ['Puppy (<1y)', 'Junior (1–3y)', 'Adult (3–7y)', 'Senior (7y+)', 'Unknown']

// ─── Report shape ───────────────────────────────────────────────────────────

export interface CustomFieldReport {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  appliesTo: 'OWNER' | 'DOG'
  filled: number // records with a non-empty value
  total: number // population (clients for OWNER, dogs for DOG)
  optionBreakdown?: { option: string; count: number }[]
}

export interface LabelCount { label: string; count: number }

export interface BusinessReports {
  months: MonthBucket[]
  customFields: CustomFieldReport[]
  clients: {
    total: number
    active: number
    inactive: number
    totalDogs: number
    dogsPerClient: number
    newPerMonth: number[]
    dogBreeds: LabelCount[]
    dogAgeGroups: LabelCount[]
    topClients: LabelCount[] // by session count
  }
  sessions: {
    total: number
    byStatus: LabelCount[]
    byType: LabelCount[]
    perMonth: number[]
    byWeekday: number[]
    hoursTracked: number
    billableCents: number
    staff: { name: string; sessions: number; hoursTracked: number }[]
  }
  engagement: {
    homeworkTotal: number
    homeworkCompleted: number
  }
  revenue: {
    currency: string
    totalCents: number
    perMonthCents: number[]
    byType: LabelCount[] // cents per purchasable kind
  }
  enquiries: {
    total: number
    byStatus: LabelCount[]
    accepted: number
  }
}

const PAID_STATUSES = ['PAID', 'PARTIALLY_REFUNDED'] as const
const KIND_LABEL: Record<string, string> = {
  PACKAGE: 'Packages', SESSION: 'Sessions', PRODUCT: 'Products', CLASS_ENROLLMENT: 'Classes',
}

// Flexible filters, all optional and composable:
//   • membershipId — scope people/session metrics to one team member
//   • from / to     — date range (createdAt / scheduledAt / paidAt)
//   • breed         — narrow dog + session metrics to one breed
// Revenue & enquiries have no member/breed dimension, so they honour only the
// date range and otherwise stay business-wide.
export interface ReportFilters {
  membershipId?: string | null
  from?: Date | null
  to?: Date | null
  breed?: string | null
  // Custom-field conditions, e.g. [{ fieldId, value: 'Yes' }]. Multiple AND
  // together — a client must match every condition.
  customFieldFilters?: { fieldId: string; value: string }[]
}

export async function getBusinessReports(
  trainerId: string,
  opts?: ReportFilters,
): Promise<BusinessReports> {
  const membershipId = opts?.membershipId ?? null
  const breed = opts?.breed?.trim() || null
  const to = opts?.to ?? new Date()
  const from = opts?.from ?? null

  // Each custom-field condition becomes its own `some` (a single value row
  // can't hold two fieldIds), AND-ed together.
  const cfAnd = (opts?.customFieldFilters ?? [])
    .filter(f => f.fieldId && f.value)
    .map(f => ({ customFieldValues: { some: { fieldId: f.fieldId, value: f.value } } }))

  // Month buckets span the selected range (default: last 12 months), capped to
  // the most recent 18 so all-time views don't explode.
  const bucketStart = from ?? new Date(to.getFullYear(), to.getMonth() - 11, 1)
  let months = monthsBetween(bucketStart, to)
  if (months.length > 18) months = months.slice(-18)

  // Date-range fragment reused across createdAt / scheduledAt / paidAt. Only
  // the bounds the caller actually set are applied.
  const dateRange = from || opts?.to
    ? { ...(from ? { gte: from } : {}), ...(opts?.to ? { lte: to } : {}) }
    : undefined

  // Scope fragments.
  const memberScope = membershipId ? { assignedMembershipId: membershipId } : {}
  const cfClientScope = cfAnd.length ? { AND: cfAnd } : {}
  const clientWhere = { trainerId, ...memberScope, ...cfClientScope, ...(dateRange ? { createdAt: dateRange } : {}) }
  const sessionWhere = {
    trainerId, ...memberScope,
    ...(breed ? { dog: { breed } } : {}),
    ...(cfAnd.length ? { client: { AND: cfAnd } } : {}),
    ...(dateRange ? { scheduledAt: dateRange } : {}),
  }
  const valueClientScope = membershipId || cfAnd.length
    ? { client: { ...memberScope, ...cfClientScope } }
    : {}
  const dogWhere = { ...(breed ? { breed } : {}), OR: [{ owner: clientWhere }, { primaryFor: { some: clientWhere } }] }

  const [
    fields,
    fieldFillCounts,
    totalClients,
    clientStatusGroups,
    dogs,
    clientCreatedAts,
    sessionStatusGroups,
    sessionTypeGroups,
    sessionScheduledAts,
    timeEntries,
    payments,
    paymentItems,
    enquiryStatusGroups,
    topClientGroups,
    memberships,
    sessionsByMember,
    homeworkTotal,
    homeworkCompleted,
  ] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, type: true, options: true, appliesTo: true },
    }),
    prisma.customFieldValue.groupBy({
      by: ['fieldId'],
      where: { field: { trainerId }, value: { not: '' }, ...valueClientScope },
      _count: { _all: true },
    }),
    prisma.clientProfile.count({ where: clientWhere }),
    prisma.clientProfile.groupBy({ by: ['status'], where: clientWhere, _count: { _all: true } }),
    prisma.dog.findMany({ where: dogWhere, select: { breed: true, dob: true } }),
    prisma.clientProfile.findMany({
      where: clientWhere,
      select: { createdAt: true },
    }),
    prisma.trainingSession.groupBy({ by: ['status'], where: sessionWhere, _count: { _all: true } }),
    prisma.trainingSession.groupBy({ by: ['sessionType'], where: sessionWhere, _count: { _all: true } }),
    prisma.trainingSession.findMany({
      where: sessionWhere,
      select: { scheduledAt: true },
    }),
    prisma.sessionTimeEntry.findMany({
      where: {
        session: {
          trainerId,
          ...(breed ? { dog: { breed } } : {}),
          ...(cfAnd.length ? { client: { AND: cfAnd } } : {}),
        },
        ...(membershipId ? { membershipId } : {}),
        ...(dateRange ? { createdAt: dateRange } : {}),
      },
      select: { minutes: true, rateCents: true, membershipId: true },
    }),
    prisma.payment.findMany({
      where: { trainerId, status: { in: [...PAID_STATUSES] }, ...(dateRange ? { paidAt: dateRange } : {}) },
      select: { amountTotal: true, amountRefunded: true, currency: true, paidAt: true, createdAt: true },
    }),
    prisma.paymentItem.findMany({
      where: { payment: { trainerId, status: { in: [...PAID_STATUSES] }, ...(dateRange ? { paidAt: dateRange } : {}) } },
      select: { kind: true, unitAmount: true, quantity: true, payment: { select: { currency: true } } },
    }),
    prisma.enquiry.groupBy({ by: ['status'], where: { trainerId, ...(dateRange ? { createdAt: dateRange } : {}) }, _count: { _all: true } }),
    prisma.trainingSession.groupBy({
      by: ['clientId'],
      where: { ...sessionWhere, clientId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { clientId: 'desc' } },
      take: 8,
    }),
    prisma.trainerMembership.findMany({
      where: { companyId: trainerId },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
    prisma.trainingSession.groupBy({
      by: ['assignedMembershipId'],
      where: { trainerId, assignedMembershipId: { not: null } },
      _count: { _all: true },
    }),
    prisma.trainingTask.count({ where: { client: clientWhere } }),
    prisma.trainingTask.count({ where: { client: clientWhere, completion: { isNot: null } } }),
  ])

  // ── Custom fields ──
  const fillByField = new Map(fieldFillCounts.map(g => [g.fieldId, g._count._all]))
  const totalDogs = dogs.length
  const dropdownIds = fields.filter(f => f.type === 'DROPDOWN').map(f => f.id)
  const optionGroups = dropdownIds.length
    ? await prisma.customFieldValue.groupBy({
        by: ['fieldId', 'value'],
        where: { fieldId: { in: dropdownIds }, value: { not: '' }, ...valueClientScope },
        _count: { _all: true },
      })
    : []
  const optionsByField = new Map<string, Map<string, number>>()
  for (const g of optionGroups) {
    if (!optionsByField.has(g.fieldId)) optionsByField.set(g.fieldId, new Map())
    optionsByField.get(g.fieldId)!.set(g.value, g._count._all)
  }

  const customFields: CustomFieldReport[] = fields.map(f => {
    const appliesTo = (f.appliesTo === 'DOG' ? 'DOG' : 'OWNER') as 'OWNER' | 'DOG'
    const base: CustomFieldReport = {
      id: f.id,
      label: f.label,
      type: f.type as CustomFieldReport['type'],
      appliesTo,
      filled: fillByField.get(f.id) ?? 0,
      total: appliesTo === 'DOG' ? totalDogs : totalClients,
    }
    if (f.type === 'DROPDOWN') {
      const declared = Array.isArray(f.options) ? (f.options as string[]) : []
      const counts = optionsByField.get(f.id) ?? new Map<string, number>()
      const seen = new Set(declared)
      const breakdown = declared.map(option => ({ option, count: counts.get(option) ?? 0 }))
      for (const [value, count] of counts) {
        if (!seen.has(value)) breakdown.push({ option: value, count })
      }
      base.optionBreakdown = breakdown
    }
    return base
  })

  // ── Clients & dogs ──
  const statusCount = (groups: { status: string; _count: { _all: number } }[], s: string) =>
    groups.find(g => g.status === s)?._count._all ?? 0

  // Dog breeds — top 8, the rest folded into "Other".
  const breedTally = new Map<string, number>()
  for (const d of dogs) {
    const b = (d.breed ?? '').trim() || 'Unknown'
    breedTally.set(b, (breedTally.get(b) ?? 0) + 1)
  }
  const sortedBreeds = [...breedTally.entries()].sort((a, b) => b[1] - a[1])
  const dogBreeds: LabelCount[] = sortedBreeds.slice(0, 8).map(([label, count]) => ({ label, count }))
  const otherBreeds = sortedBreeds.slice(8).reduce((s, [, c]) => s + c, 0)
  if (otherBreeds > 0) dogBreeds.push({ label: 'Other', count: otherBreeds })

  // Dog age groups (kept in a sensible order, zero buckets dropped).
  const ageTally = new Map<string, number>()
  for (const d of dogs) {
    const g = ageGroup(d.dob)
    ageTally.set(g, (ageTally.get(g) ?? 0) + 1)
  }
  const dogAgeGroups: LabelCount[] = AGE_ORDER
    .filter(g => (ageTally.get(g) ?? 0) > 0)
    .map(g => ({ label: g, count: ageTally.get(g)! }))

  // Top clients by session count — resolve names for the grouped ids.
  const topIds = topClientGroups.map(g => g.clientId!).filter(Boolean)
  const topNames = topIds.length
    ? await prisma.clientProfile.findMany({
        where: { id: { in: topIds } },
        select: { id: true, user: { select: { name: true, email: true } } },
      })
    : []
  const nameById = new Map(topNames.map(c => [c.id, c.user.name ?? c.user.email]))
  const topClients: LabelCount[] = topClientGroups.map(g => ({
    label: nameById.get(g.clientId!) ?? 'Unknown',
    count: g._count._all,
  }))

  // ── Sessions ──
  let hoursMinutes = 0
  let billableCents = 0
  const minutesByMember = new Map<string, number>()
  for (const e of timeEntries) {
    hoursMinutes += e.minutes
    if (e.rateCents != null) billableCents += Math.round((e.minutes / 60) * e.rateCents)
    minutesByMember.set(e.membershipId, (minutesByMember.get(e.membershipId) ?? 0) + e.minutes)
  }
  const sessionsByMemberMap = new Map(sessionsByMember.map(g => [g.assignedMembershipId!, g._count._all]))
  // The team-member breakdown only makes sense business-wide; when filtered to
  // a single member there's nothing to compare, so it's suppressed.
  const staff = membershipId
    ? []
    : memberships
        .map(m => ({
          name: m.user.name ?? m.user.email,
          sessions: sessionsByMemberMap.get(m.id) ?? 0,
          hoursTracked: Math.round(((minutesByMember.get(m.id) ?? 0) / 60) * 10) / 10,
        }))
        .sort((a, b) => b.sessions - a.sessions)

  // ── Revenue ──
  const currencyTally = new Map<string, number>()
  for (const p of payments) currencyTally.set(p.currency, (currencyTally.get(p.currency) ?? 0) + 1)
  const currency = [...currencyTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'nzd'
  const revIdx = new Map(months.map((b, i) => [b.key, i]))
  const perMonthCents = new Array(months.length).fill(0)
  let totalCents = 0
  for (const p of payments) {
    if (p.currency !== currency) continue
    const net = p.amountTotal - p.amountRefunded
    totalCents += net
    const i = revIdx.get(monthKey(p.paidAt ?? p.createdAt))
    if (i !== undefined) perMonthCents[i] += net
  }
  // Revenue by purchasable kind (gross line value, dominant currency only).
  const kindTally = new Map<string, number>()
  for (const it of paymentItems) {
    if (it.payment.currency !== currency) continue
    kindTally.set(it.kind, (kindTally.get(it.kind) ?? 0) + it.unitAmount * it.quantity)
  }
  const byType: LabelCount[] = [...kindTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, cents]) => ({ label: KIND_LABEL[kind] ?? kind, count: cents }))

  return {
    months,
    customFields,
    clients: {
      total: totalClients,
      active: statusCount(clientStatusGroups, 'ACTIVE'),
      inactive: statusCount(clientStatusGroups, 'INACTIVE'),
      totalDogs,
      dogsPerClient: totalClients > 0 ? totalDogs / totalClients : 0,
      newPerMonth: bucketCounts(clientCreatedAts.map(c => c.createdAt), months),
      dogBreeds,
      dogAgeGroups,
      topClients,
    },
    sessions: {
      total: sessionStatusGroups.reduce((s, g) => s + g._count._all, 0),
      byStatus: sessionStatusGroups.map(g => ({ label: g.status, count: g._count._all })),
      byType: sessionTypeGroups.map(g => ({ label: g.sessionType, count: g._count._all })),
      perMonth: bucketCounts(sessionScheduledAts.map(s => s.scheduledAt), months),
      byWeekday: weekdayCounts(sessionScheduledAts.map(s => s.scheduledAt)),
      hoursTracked: Math.round((hoursMinutes / 60) * 10) / 10,
      billableCents,
      staff,
    },
    engagement: { homeworkTotal, homeworkCompleted },
    revenue: { currency, totalCents, perMonthCents, byType },
    enquiries: {
      total: enquiryStatusGroups.reduce((s, g) => s + g._count._all, 0),
      byStatus: enquiryStatusGroups.map(g => ({ label: g.status, count: g._count._all })),
      accepted: enquiryStatusGroups.find(g => g.status === 'ACCEPTED')?._count._all ?? 0,
    },
  }
}

// Options for the report filter bar: the team members to scope by and the
// breeds present in the trainer's dogs.
export interface ReportFilterField {
  id: string
  label: string
  appliesTo: 'OWNER' | 'DOG'
  options: string[]
}

export async function getReportFilterOptions(trainerId: string): Promise<{
  members: { id: string; name: string }[]
  breeds: string[]
  customFields: ReportFilterField[]
}> {
  const [members, dogs, fields] = await Promise.all([
    prisma.trainerMembership.findMany({
      where: { companyId: trainerId },
      select: { id: true, user: { select: { name: true, email: true } } },
      orderBy: { acceptedAt: 'asc' },
    }),
    prisma.dog.findMany({
      where: { OR: [{ owner: { trainerId } }, { primaryFor: { some: { trainerId } } }] },
      select: { breed: true },
    }),
    // Only DROPDOWN fields make sensible filters (finite, known options).
    prisma.customField.findMany({
      where: { trainerId, type: 'DROPDOWN' },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, appliesTo: true, options: true },
    }),
  ])
  const breeds = [...new Set(dogs.map(d => (d.breed ?? '').trim()).filter(Boolean))].sort()
  return {
    members: members.map(m => ({ id: m.id, name: m.user.name ?? m.user.email })),
    breeds,
    customFields: fields.map(f => ({
      id: f.id,
      label: f.label,
      appliesTo: f.appliesTo === 'DOG' ? 'DOG' : 'OWNER',
      options: Array.isArray(f.options) ? (f.options as string[]) : [],
    })),
  }
}
