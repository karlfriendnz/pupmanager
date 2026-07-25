import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { classSessionSpaces, sessionDropInPriceCents, sessionCapacity } from '@/lib/class-runs'
import { getActiveClient } from '@/lib/client-context'
import { todayInTz } from '@/lib/timezone'
import { slotAppliesOnDate, isBlackoutDate } from '@/lib/availability'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { loadPublishedMemberships } from '@/lib/client-memberships'
import { BookingWizard, type WizardPackage, type WizardClass, type PreviewDay } from './booking-wizard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Availability' }

const DAYS_AHEAD = 28

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function dayOfWeekIso(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

// Date labels are derived deterministically from the trainer-local calendar
// date (dateStr) — never via toLocaleDateString with a timeZone, which can tip
// a noon-UTC instant onto the wrong day for far-offset zones (e.g. NZ).
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function dayMonthShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${d} ${MONTH_SHORT[m - 1]}`
}

function parseHM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function fmt12(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function subtractRanges(slotStart: number, slotEnd: number, booked: { start: number; end: number }[]): { startMin: number; endMin: number }[] {
  const clamped = booked
    .map(b => ({ start: Math.max(slotStart, b.start), end: Math.min(slotEnd, b.end) }))
    .filter(b => b.start < b.end)
    .sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const b of clamped) {
    const last = merged[merged.length - 1]
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end)
    else merged.push({ ...b })
  }
  const free: { startMin: number; endMin: number }[] = []
  let cursor = slotStart
  for (const b of merged) {
    if (b.start > cursor) free.push({ startMin: cursor, endMin: b.start })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < slotEnd) free.push({ startMin: cursor, endMin: slotEnd })
  return free
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '🐾'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default async function MyAvailabilityPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const avail = await getTrainerAvailabilityForClient(active.clientId)
  if (!avail) redirect('/login')
  const { businessName, tz, slots, blackouts, busy } = avail

  // Everything the wizard needs, gathered server-side so it reuses the proven
  // self-book / class-enrol POST endpoints without inventing new APIs.
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      trainerId: true,
      dogId: true,
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
      trainer: { select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, payoutCurrency: true } },
    },
  })
  if (!profile) redirect('/login')

  // Self-bookable 1-on-1 packages (mirrors GET /api/my/self-book).
  // isGroup: false is load-bearing. A class or drop-in with self-booking on
  // was landing here too, and the 1:1 flow then offered the trainer's open
  // hours — "pick any Tuesday at 2pm" — for something that runs on its own
  // fixed timetable. Group offerings are booked from the classes list below,
  // by their real sessions.
  const rawPackages = await prisma.package.findMany({
    where: { trainerId: profile.trainerId, clientSelfBook: true, isGroup: false },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, imageUrl: true, description: true, sessionCount: true, weeksBetween: true,
      durationMins: true, bufferMins: true, sessionType: true, priceCents: true,
      specialPriceCents: true, selfBookRequiresApproval: true, allowWaitlist: true,
    },
  })
  const packages: WizardPackage[] = rawPackages.map(p => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    description: p.description,
    sessionCount: p.sessionCount,
    weeksBetween: p.weeksBetween,
    durationMins: p.durationMins,
    bufferMins: p.bufferMins ?? 0,
    sessionType: p.sessionType as 'IN_PERSON' | 'VIRTUAL',
    priceCents: p.specialPriceCents ?? p.priceCents,
    selfBookRequiresApproval: p.selfBookRequiresApproval,
    allowWaitlist: p.allowWaitlist,
  }))

  // Open group classes the client can join themselves.
  const enrolled = await prisma.classEnrollment.findMany({
    where: { clientId: active.clientId, status: { in: ['ENROLLED', 'WAITLISTED', 'COMPLETED'] } },
    select: { classRunId: true, type: true, dropInSessionId: true },
  })
  // Only a FULL enrolment takes a class off the list — that one covers every
  // session, so there's nothing left to book. A drop-in covers ONE session, so
  // hiding the whole class after the first booking hid it from exactly the
  // people most likely to come back for another week. The sessions they
  // already hold are marked below instead.
  const enrolledRunIds = enrolled.filter(e => e.type === 'FULL').map(e => e.classRunId)
  const bookedSessionIds = new Set(enrolled.map(e => e.dropInSessionId).filter(Boolean) as string[])
  const now = new Date()
  const openRuns = await prisma.classRun.findMany({
    where: {
      trainerId: profile.trainerId,
      status: { in: ['SCHEDULED', 'RUNNING'] },
      id: { notIn: enrolledRunIds.length ? enrolledRunIds : ['__none__'] },
      sessions: { some: { scheduledAt: { gte: now } } },
    },
    orderBy: { startDate: 'asc' },
    include: {
      package: { select: { name: true, priceCents: true, specialPriceCents: true, allowDropIn: true, dropInPriceCents: true, capacity: true, allowWaitlist: true } },
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true, type: true, dropInSessionId: true } },
      sessions: {
        where: { scheduledAt: { gte: now } },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true, scheduledAt: true, durationMins: true, title: true,
          // A drop-in class prices and caps each session on its own slot.
          packageSessionSlot: { select: { capacity: true, priceCents: true, specialPriceCents: true } },
        },
      },
    },
  })
  const classes: WizardClass[] = openRuns.map(r => {
    const cap = r.capacity ?? r.package.capacity ?? null
    // One source of truth for per-session spaces, shared with the trainer's
    // assign modal (full seats count on every session, a drop-in only on its
    // own — so a "full" term can still have room in a given week).
    const spaces = classSessionSpaces(cap, r.enrollments)
    return {
      id: r.id,
      name: r.name,
      imageUrl: r.imageUrl,
      scheduleNote: r.scheduleNote,
      packageName: r.package.name,
      nextSessionAt: r.sessions[0]?.scheduledAt.toISOString() ?? null,
      sessions: r.sessions.map(s => ({
        id: s.id,
        at: s.scheduledAt.toISOString(),
        durationMins: s.durationMins,
        title: s.title,
        spacesLeft: spaces.spacesLeftFor(s.id, sessionCapacity(s.packageSessionSlot, r.capacity, r.package.capacity)),
        // Already theirs — shown as booked in the picker rather than offered
        // again and refused at checkout.
        booked: bookedSessionIds.has(s.id),
        // What THIS session costs to drop into — a drop-in class can charge a
        // different price on different days.
        dropInPriceCents: sessionDropInPriceCents(s.packageSessionSlot, r.package),
      })),
      seatsLeft: cap === null ? null : Math.max(0, cap - spaces.fullSeats),
      fullPriceCents: r.package.specialPriceCents ?? r.package.priceCents,
      allowDropIn: r.package.allowDropIn,
      dropInPerSessionCents: r.package.dropInPriceCents,
      allowWaitlist: r.package.allowWaitlist,
    }
  })

  // Memberships are an offering TYPE in this flow rather than their own nav
  // entry — same published one-off bundles the /my-memberships page sells.
  const memberships = await loadPublishedMemberships(profile.trainerId)

  const allDogs = [
    ...(profile.dog ? [profile.dog] : []),
    ...profile.dogs,
  ].filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i)

  // Read-only preview of the trainer's open windows — shown only when there's
  // nothing to self-book, so the page still answers "when are they free?".
  const today = todayInTz(tz)
  const sessionsByDate = new Map<string, { start: number; end: number }[]>()
  for (const b of busy) {
    const arr = sessionsByDate.get(b.dateStr) ?? []
    arr.push({ start: b.startMin, end: b.endMin })
    sessionsByDate.set(b.dateStr, arr)
  }
  const previewDays: PreviewDay[] = []
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const dateStr = addDayStr(today, i)
    if (isBlackoutDate(blackouts, dateStr)) continue
    const isoDow = dayOfWeekIso(dateStr)
    const applicable = slots.filter(s => slotAppliesOnDate(s, dateStr, isoDow))
    if (applicable.length === 0) continue
    const booked = sessionsByDate.get(dateStr) ?? []
    const ranges: string[] = []
    for (const slot of applicable) {
      for (const f of subtractRanges(parseHM(slot.startTime), parseHM(slot.endTime), booked)) {
        ranges.push(`${fmt12(f.startMin)} – ${fmt12(f.endMin)}`)
      }
    }
    if (ranges.length > 0) previewDays.push({ weekday: weekdayShort(dateStr), dayLabel: dayMonthShort(dateStr), ranges })
  }

  return (
    <BookingWizard
      businessName={businessName}
      initials={initialsOf(businessName)}
      tz={tz}
      availability={{ tz, slots, blackouts, busy }}
      packages={packages}
      classes={classes}
      memberships={memberships}
      dogs={allDogs}
      defaultDogId={profile.dogId}
      acceptPayments={!!(profile.trainer.acceptPaymentsEnabled && profile.trainer.connectChargesEnabled)}
      currency={profile.trainer.payoutCurrency}
      previewDays={previewDays}
    />
  )
}
