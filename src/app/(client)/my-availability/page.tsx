import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { classSessionSpaces, sessionDropInPriceCents, sessionCapacity, isEventPackage, MAX_TICKET_QUANTITY } from '@/lib/class-runs'
import { toWizardEvent } from '@/lib/client-wizard-events'
import { getActiveClient } from '@/lib/client-context'
import { todayInTz } from '@/lib/timezone'
import { slotAppliesOnDate, isBlackoutDate } from '@/lib/availability'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { loadPublishedMemberships } from '@/lib/client-memberships'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '@/lib/feature-flags'
import { mergeClientDogs } from '@/lib/dogs'
import { getEnabledAddons } from '@/lib/billing'
import { selfBookablePackagesWhere, openClassRunsWhere } from '@/lib/bookable-offerings'
import { BookingWizard, type WizardPackage, type WizardClass, type WizardEvent, type WizardTag, type WizardProduct, type PreviewDay } from './booking-wizard'
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
      dog: { select: { id: true, name: true, deceasedAt: true } },
      dogs: { select: { id: true, name: true, deceasedAt: true } },
      trainer: { select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, payoutCurrency: true } },
    },
  })
  if (!profile) redirect('/login')

  // Self-bookable 1-on-1 packages (mirrors GET /api/my/self-book).
  //
  // The where-clause lives in lib/bookable-offerings, because the client home's
  // Bookings tile has to count the SAME things to decide whether to show itself
  // at all. Two copies of it is how the tile and this page come to disagree.
  const rawPackages = await prisma.package.findMany({
    // Excludes one the trainer has scheduled to appear later — see
    // lib/offering-visibility. The tag section further down intersects THIS
    // list, so gating here empties the tags of hidden offerings too.
    where: selfBookablePackagesWhere(profile.trainerId),
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
  //
  // Deliberately NOT filtered by suspendedAt. A membership that has stopped
  // being paid for has its seats PAUSED, not withdrawn — the client still holds
  // the place. Hiding a paused seat here would put the class back on the "join
  // this" list and let them pay a second time for a seat they already have.
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
  // A run needs a live session still to come, and inherits its offering's
  // visibility — next term's classes can be built in November without appearing
  // here until the trainer says so. Shared with the home tile's count; see
  // lib/bookable-offerings.
  const openRuns = await prisma.classRun.findMany({
    where: openClassRunsWhere(profile.trainerId, enrolledRunIds, now),
    // The trainer's own arranged order (from dragging their Classes list) is
    // what a client sees; start date breaks ties.
    orderBy: [{ order: 'asc' }, { startDate: 'asc' }],
    include: {
      package: {
        select: {
          name: true, priceCents: true, specialPriceCents: true, allowDropIn: true, dropInPriceCents: true,
          capacity: true, allowWaitlist: true,
          // Needed to tell an EVENT from a class, and to price a ticketed
          // event off its tiers rather than the package price.
          isEvent: true, isGroup: true, sessionCount: true, recurrenceRule: true,
          ticketTiers: { orderBy: { order: 'asc' }, select: { id: true, name: true, priceCents: true, capacity: true } },
        },
      },
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true, type: true, dropInSessionId: true, quantity: true, ticketTierId: true } },
      sessions: {
        // A cancelled week is not bookable and must not be listed as one.
        where: { scheduledAt: { gte: now }, cancelledAt: null },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true, scheduledAt: true, durationMins: true, title: true,
          // A drop-in class prices and caps each session on its own slot.
          packageSessionSlot: { select: { capacity: true, priceCents: true, specialPriceCents: true } },
        },
      },
    },
  })
  // An EVENT is an offering the trainer declared as one — the same predicate
  // the trainer's Events list uses, so the two ends can't disagree. They were
  // being listed here as "Group classes", and a ticketed one was quoted at the
  // package price: the $45 shown for a $200 ticket. Split out, they get their
  // own type and are priced by the ticket.
  const eventRuns = openRuns.filter(r => isEventPackage(r.package))
  const classRuns = openRuns.filter(r => !isEventPackage(r.package))

  const events: WizardEvent[] = eventRuns.map(toWizardEvent)

  const classes: WizardClass[] = classRuns.map(r => {
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
  const memberships = PACKAGES_HIDDEN_FROM_CLIENTS
    ? []
    : await loadPublishedMemberships(profile.trainerId, active.clientId)

  // ─── Browse by tag ────────────────────────────────────────────────────────
  //
  // A tag is the trainer's answer to "what have you got for a new puppy?", and
  // the answer is a course AND a 1:1 AND the clicker in their shop. So the tag
  // is resolved here, across all of them, into ids the wizard already holds —
  // rather than the wizard being handed a second, parallel catalogue.
  //
  // Tags point at PACKAGES, but a client books a class by its RUN, so a tagged
  // group package reaches every open run off it. That is deliberate: the
  // trainer tags "Puppy Foundations" once and every term of it is in the tag.
  const shopOn = (await getEnabledAddons(profile.trainerId)).has('shop')
  const [tagRows, taggedProducts] = await Promise.all([
    prisma.tag.findMany({
      where: { trainerId: profile.trainerId },
      // The trainer's own arrangement, same as everywhere else they order things.
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, items: { select: { packageId: true, productId: true } } },
    }),
    shopOn
      ? prisma.product.findMany({
          where: { trainerId: profile.trainerId, active: true, tags: { some: {} } },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
          select: { id: true, name: true, imageUrl: true, priceCents: true, salePriceCents: true },
        })
      : [],
  ])

  const bookablePackageIds = new Set(packages.map(p => p.id))
  const sellableProductIds = new Set(taggedProducts.map(p => p.id))
  // packageId → the open runs off it, split the same way the lists above are.
  const runsByPackage = new Map<string, { classes: string[]; events: string[] }>()
  const noteRun = (packageId: string, key: 'classes' | 'events', runId: string) => {
    const entry = runsByPackage.get(packageId) ?? { classes: [], events: [] }
    entry[key].push(runId)
    runsByPackage.set(packageId, entry)
  }
  for (const r of classRuns) noteRun(r.packageId, 'classes', r.id)
  for (const r of eventRuns) noteRun(r.packageId, 'events', r.id)

  const tags: WizardTag[] = tagRows
    .map(t => {
      const packageIds: string[] = []
      const classIds: string[] = []
      const eventIds: string[] = []
      const productIds: string[] = []
      for (const item of t.items) {
        if (item.packageId) {
          // Only what this client can actually act on. A tagged offering with
          // self-booking off, or a class whose every run has finished, would be
          // a row that goes nowhere.
          if (bookablePackageIds.has(item.packageId)) packageIds.push(item.packageId)
          const runs = runsByPackage.get(item.packageId)
          if (runs) { classIds.push(...runs.classes); eventIds.push(...runs.events) }
        } else if (item.productId && sellableProductIds.has(item.productId)) {
          productIds.push(item.productId)
        }
      }
      return { id: t.id, name: t.name, packageIds, classIds, eventIds, productIds }
    })
    // An empty tag is the trainer's business, not the client's. Showing one
    // would be a row that opens onto nothing.
    .filter(t => t.packageIds.length + t.classIds.length + t.eventIds.length + t.productIds.length > 0)

  const products: WizardProduct[] = taggedProducts.map(p => ({
    id: p.id,
    name: p.name,
    imageUrl: p.imageUrl,
    // The sale price is the one actually charged, so it is the one quoted —
    // same rule as the shop.
    priceCents: p.salePriceCents ?? p.priceCents,
  }))

  // This list only feeds the booking wizard's dog picker, so a dog that has
  // died is left out — there is nothing here to book them onto.
  const allDogs = mergeClientDogs(profile.dog, profile.dogs).filter(d => !d.deceasedAt)

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
      events={events}
      tags={tags}
      products={products}
      maxTicketQuantity={MAX_TICKET_QUANTITY}
      memberships={memberships}
      dogs={allDogs}
      defaultDogId={profile.dogId}
      acceptPayments={!!(profile.trainer.acceptPaymentsEnabled && profile.trainer.connectChargesEnabled)}
      currency={profile.trainer.payoutCurrency}
      previewDays={previewDays}
    />
  )
}
