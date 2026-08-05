'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  CalendarPlus, GraduationCap, Clock, Users, Video, MapPin, Check, CheckCircle2,
  Loader2, ChevronLeft, ChevronRight, ArrowRight, CalendarDays, Repeat, Ticket, PartyPopper,
  Minus, Plus, ShoppingBag, Tag as TagIcon, X,
} from 'lucide-react'
import { openExternal } from '@/lib/external-link'
import { labelFor } from '@/lib/nav-labels'
import { useNavLabelOverrides } from '@/components/shared/page-title'
import { currencySymbol } from '@/lib/money'
import { MembershipCards } from '@/components/shared/membership-cards'
import type { ClientMembership } from '@/lib/client-memberships'
import { type AvailabilityRow, type BlackoutRow, type BusyInterval } from '@/lib/availability'
import { bookableStartTimes, ANY_TIME_WINDOW, type PackageBookingWindow } from '@/lib/package-booking-window'
import { zonedToUtc, todayInTz } from '@/lib/timezone'
import {
  groupSessionsByDay, monthOf, monthLabel, monthGrid, monthsWithSessions,
  defaultOpenDay, picksOnDay, selectedInOrder, allSelectableIds,
} from '@/lib/session-calendar'
import type { BasketClassLine } from '@/lib/basket'
import { useBasketOptional } from '../basket/basket-context'

export interface WizardPackage {
  id: string
  name: string
  imageUrl: string | null
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  bufferMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  selfBookRequiresApproval: boolean
  allowWaitlist: boolean
  /**
   * When this offering is on offer, if the trainer restricted it. Omitted =
   * any time they're free, which is what every offering meant before this
   * existed. Resolved server-side by packageBookingWindow() — the SAME window
   * /api/my/self-book re-checks the chosen time against, so this screen can
   * never offer a time the POST will refuse.
   */
  bookingWindow?: PackageBookingWindow
}

export interface WizardClass {
  id: string
  name: string
  imageUrl: string | null
  scheduleNote: string | null
  packageName: string
  nextSessionAt: string | null
  // Upcoming sessions. spacesLeft and dropInPriceCents are per-session (a
  // drop-in class can cap and price each day differently), so the same list
  // doubles as the drop-in picker.
  sessions: {
    id: string
    at: string
    durationMins: number
    title: string
    spacesLeft: number | null
    dropInPriceCents: number | null
    /** This client already holds this session — not on offer again. */
    booked: boolean
  }[]
  seatsLeft: number | null
  fullPriceCents: number | null
  allowDropIn: boolean
  dropInPerSessionCents: number | null
  allowWaitlist: boolean
}

/** One ticket type on a ticketed event. Priced by the tier, never the package. */
export interface WizardEventTier {
  id: string
  name: string
  priceCents: number | null
  /** Null = this tier isn't capped. 0 = sold out. */
  spacesLeft: number | null
}

/**
 * A one-off EVENT — a group run the trainer created as an event. Separate from
 * WizardClass
 * because the two are priced differently: a class sells a seat (or a drop-in)
 * at the package price, while a ticketed event sells a TICKET at its tier's
 * price. `priceCents` is only populated when there are no tiers.
 */
export interface WizardEvent {
  id: string
  name: string
  imageUrl: string | null
  scheduleNote: string | null
  packageName: string
  startsAt: string | null
  durationMins: number | null
  seatsLeft: number | null
  priceCents: number | null
  tiers: WizardEventTier[]
  allowWaitlist: boolean
}

/**
 * One of the trainer's tags, already resolved to ids this screen holds.
 *
 * The whole point of a tag is that it reaches ACROSS the types: "Puppy" holds a
 * course, a 1:1 session and a product at once. So it arrives as four id lists
 * rather than a type + a filter, and the server has already dropped anything
 * this client can't act on.
 */
export interface WizardTag {
  id: string
  name: string
  packageIds: string[]
  classIds: string[]
  eventIds: string[]
  productIds: string[]
}

/** A shop product that carries at least one tag. Products are BOUGHT, not
 *  booked, so these rows leave for the shop rather than entering the wizard. */
export interface WizardProduct {
  id: string
  name: string
  imageUrl: string | null
  priceCents: number | null
}

export interface PreviewDay {
  weekday: string
  dayLabel: string
  ranges: string[]
}

interface Availability {
  tz: string
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
}

// How far ahead the picker offers days — matches the server window.
const DAYS_AHEAD = 28
// Granularity of offered start times inside each window.
const STEP_MINS = 30

// Whole dollars stay whole ("$45", not "$45.00") — that's this screen's house
// style. The SYMBOL comes from lib/money so there's one table for it and no
// hard-coded "$" hiding a trainer who charges in £ or R.
function price(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null
  const sym = currencySymbol(currency ?? 'nzd') || '$'
  return `${sym}${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Label a trainer-local date deterministically from its own calendar value — NOT
// via toLocaleDateString, which renders in the VIEWER's timezone and shows the
// wrong weekday for a client in a different tz than their trainer.
function dowIdx(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
function fmtWeekday(dateStr: string): string { return WEEKDAY_SHORT[dowIdx(dateStr)] }
function fmtDayNum(dateStr: string): string { return String(Number(dateStr.split('-')[2])) }
function fmtFullDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${WEEKDAY_SHORT[dowIdx(dateStr)]} ${d} ${MONTH_SHORT[m - 1]}`
}
function fmtMonth(dateStr: string): string { return MONTH_SHORT[Number(dateStr.split('-')[1]) - 1] }

// Just the clock time of a session, in the TRAINER's zone — same reasoning as
// fmtNextSession below: the viewer's zone is not the class's zone, and a 7:30pm
// NZ class read as 7:30am to anyone looking from London.
function fmtTimeInTz(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', { timeZone, hour: 'numeric', minute: '2-digit' }).toUpperCase()
}

function fmtTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// The UTC instant for a trainer-local date + "HH:MM".
function toUtcIso(dateStr: string, hhmm: string, tz: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return zonedToUtc(y, m, d, h, min, tz).toISOString()
}

// The wizard already knows the trainer's zone (props.tz) — use it. Without it
// this formatted in the SERVER's zone during SSR and the VIEWER's after
// hydration, so a class starting 6pm showed as 6am on the booking summary.
// The year is here because a course can run past one. A 12-session class every
// ten weeks lists "Sat, 12 Dec" and "Sat, 20 Jan" — which is over a year apart,
// and reads as the wrong way round without it. Two digits: enough to tell the
// dates apart, short enough not to crowd the row.
function fmtNextSession(iso: string | null, timeZone: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-NZ', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit' })
}

type Selection =
  | { kind: 'session'; pkg: WizardPackage }
  | { kind: 'class'; cls: WizardClass }
  | { kind: 'event'; ev: WizardEvent }

type DoneMode = 'booked' | 'requested' | 'enrolled' | 'waitlisted'

export function BookingWizard(props: {
  businessName: string
  initials: string
  tz: string
  availability: Availability
  packages: WizardPackage[]
  classes: WizardClass[]
  events: WizardEvent[]
  /** The trainer's tags, in their order, already emptied of anything this
   *  client can't act on. */
  tags: WizardTag[]
  /** Every tagged, on-sale product — the only products this screen knows about. */
  products: WizardProduct[]
  /** Server's ticket-quantity ceiling, so the stepper can't offer more than the API takes. */
  maxTicketQuantity: number
  memberships: ClientMembership[]
  dogs: { id: string; name: string }[]
  defaultDogId: string | null
  acceptPayments: boolean
  currency: string | null
  previewDays: PreviewDay[]
}) {
  const { businessName, initials, tz, availability, packages, classes, events, tags, products, maxTicketQuantity, memberships, dogs, defaultDogId, acceptPayments, currency, previewDays } = props

  // The trainer's own words for what they sell. A trainer who renames "1:1
  // Sessions" to "Private lessons" was still showing their clients our words in
  // the one place a client actually chooses between them. labelFor enforces the
  // locks, so a client can never be shown a word the trainer wasn't allowed to set.
  const navLabels = useNavLabelOverrides()
  const term = {
    oneToOne: labelFor('/packages', '1-on-1 sessions', navLabels),
    classes: labelFor('/classes', 'Group classes', navLabels),
    events: labelFor('/events', 'Events', navLabels),
    memberships: labelFor('/memberships', 'Packages', navLabels),
  }

  const [step, setStep] = useState<1 | 2 | 3>(1)
  // Step 1 is a menu of offering TYPES, plus the trainer's tags; picking either
  // drills into a list. A tag is `tag:<id>` rather than its own state, so there
  // is still exactly ONE thing that says what step 1 is showing — two would go
  // out of step the first time someone forgot to clear the other.
  const [category, setCategory] = useState<'sessions' | 'classes' | 'events' | 'memberships' | `tag:${string}` | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  // ─── Browse by tag ────────────────────────────────────────────────────────
  //
  // ONE MIXED SCREEN, not a filter per list. A tag exists precisely because the
  // course, the 1:1 and the clicker belong together; a filter bolted onto the
  // classes list and a second one onto the shop could never show them on the
  // same screen, and would make the trainer keep the same word in two places to
  // no benefit. The sections stay labelled inside it, because you BOOK a class
  // and you BUY a clicker and pretending otherwise helps nobody.
  const activeTag = category?.startsWith('tag:')
    ? tags.find(t => t.id === category.slice(4)) ?? null
    : null
  const shownPackages = activeTag ? packages.filter(p => activeTag.packageIds.includes(p.id)) : packages
  const shownClasses = activeTag ? classes.filter(c => activeTag.classIds.includes(c.id)) : classes
  const shownEvents = activeTag ? events.filter(e => activeTag.eventIds.includes(e.id)) : events
  const shownProducts = activeTag ? products.filter(p => activeTag.productIds.includes(p.id)) : []

  // Ticketed-event state: which ticket type, and how many.
  const [ticketTierId, setTicketTierId] = useState<string | null>(null)
  const [ticketQty, setTicketQty] = useState(1)

  // Session (package) picker state.
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  // Class options state.
  // One or more dogs — book several into the same class/sessions at once.
  const [dogIds, setDogIds] = useState<string[]>(defaultDogId ? [defaultDogId] : [])
  const dogId = dogIds[0] ?? null // primary, for single-dog displays
  const toggleDog = (id: string) =>
    setDogIds(prev => (prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]))
  const [classType, setClassType] = useState<'FULL' | 'DROP_IN'>('FULL')
  // Which sessions a drop-in is for. Several at once: someone coming to three
  // Saturdays shouldn't pay for them one checkout at a time.
  const [dropInSessionIds, setDropInSessionIds] = useState<string[]>([])
  const toggleSession = (id: string) =>
    setDropInSessionIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DoneMode | null>(null)

  const pkg = selection?.kind === 'session' ? selection.pkg : null
  const cls = selection?.kind === 'class' ? selection.cls : null
  const ev = selection?.kind === 'event' ? selection.ev : null
  const tier = ev?.tiers.find(t => t.id === ticketTierId) ?? null

  // Bookable start times on a given day — always dropping any that have already
  // been and gone. The past-filter belongs HERE, not just on the chosen day:
  // otherwise today keeps being offered after its last slot has passed, the day
  // auto-selects, no time can, and the wizard dead-ends on "Pick a time" with
  // nothing to pick. (Only reproducible late in the trainer's day.)
  const startTimesFor = useCallback((dateStr: string) => {
    if (!pkg) return []
    const now = Date.now()
    // One resolver, shared with the server. The offering's own booking window
    // narrows the trainer's availability here exactly as checkBookableStart
    // narrows it in /api/my/self-book — so what's on screen and what the route
    // will accept are computed from the same rule, not two copies of it.
    return bookableStartTimes({
      slots: availability.slots,
      blackouts: availability.blackouts,
      busy: availability.busy,
      dateStr,
      durationMins: pkg.durationMins,
      bufferMins: pkg.bufferMins,
      stepMins: STEP_MINS,
      window: pkg.bookingWindow ?? ANY_TIME_WINDOW,
    }).filter(t => new Date(toUtcIso(dateStr, t, tz)).getTime() > now)
  }, [pkg, availability, tz])

  // Days in the window that can still hold this package's first session.
  const availableDates = useMemo(() => {
    if (!pkg) return []
    const today = todayInTz(tz)
    const out: string[] = []
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dateStr = addDayStr(today, i)
      if (startTimesFor(dateStr).length > 0) out.push(dateStr)
    }
    return out
  }, [pkg, tz, startTimesFor])

  // Valid start times for the chosen day.
  const timeOptions = useMemo(() => (date ? startTimesFor(date) : []), [date, startTimesFor])

  // Keep the selected day valid as the package changes.
  useEffect(() => {
    if (!pkg) return
    if (availableDates.length === 0) { setDate(''); return }
    if (!availableDates.includes(date)) setDate(availableDates[0])
  }, [pkg, availableDates, date])

  // Keep the selected time valid as the day changes.
  useEffect(() => {
    if (timeOptions.length === 0) { setTime(''); return }
    if (!timeOptions.includes(time)) setTime(timeOptions[0])
  }, [timeOptions, time])

  const nothingToBook = packages.length === 0 && classes.length === 0 && events.length === 0 && memberships.length === 0

  function chooseSession(p: WizardPackage) {
    setSelection({ kind: 'session', pkg: p })
    setError(null)
    setStep(2)
  }
  function chooseClass(c: WizardClass) {
    setSelection({ kind: 'class', cls: c })
    // A drop-in class is SOLD per session, so that's the state it opens in —
    // the picker is the page. "All of them" is Select all, not a separate
    // full-course mode the client has to find first.
    setClassType(c.allowDropIn && c.dropInPerSessionCents != null ? 'DROP_IN' : 'FULL')
    setDropInSessionIds([])
    setDogIds(defaultDogId ? [defaultDogId] : [])
    setError(null)
    setStep(2)
  }
  function chooseEvent(e: WizardEvent) {
    setSelection({ kind: 'event', ev: e })
    // Pre-select the first ticket type that still has room — a ticketed event
    // MUST name one or the API refuses the booking outright.
    setTicketTierId(e.tiers.find(t => t.spacesLeft == null || t.spacesLeft > 0)?.id ?? null)
    setTicketQty(1)
    setDogIds(defaultDogId ? [defaultDogId] : [])
    setError(null)
    setStep(2)
  }
  function back() {
    setError(null)
    if (step === 3) setStep(2)
    else if (step === 2) { setStep(1); setSelection(null) }
  }

  // ── The basket ─────────────────────────────────────────────────────────────
  // A client booking three casual Saturdays AND buying a long line shouldn't
  // meet the card box three times. The basket lives in the client layout, so
  // it's read optionally here — this wizard is also rendered in the trainer's
  // preview harness, where there isn't one, and a hard hook would blank it.
  const basket = useBasketOptional()

  /**
   * The current class/event choice as a basket line, or null when it isn't
   * something a basket can hold (a 1:1 booking picks a TIME, which can't sit in
   * a basket going stale, and a free class has nothing to charge).
   *
   * The estimate multiplies by the number of dogs, which the confirm summary
   * above doesn't — the server bills per dog, so a two-dog booking that showed
   * one dog's price in the basket would surprise them at the card box.
   */
  function currentBasketLine(): BasketClassLine | null {
    const dogCount = Math.max(1, dogIds.length)
    const dogSuffix = dogIds.length > 1 ? ` · ${dogIds.length} dogs` : ''
    if (selection?.kind === 'class') {
      const c = selection.cls
      if (classType === 'DROP_IN') {
        const chosen = c.sessions.filter(s => dropInSessionIds.includes(s.id))
        if (chosen.length === 0) return null
        const each = chosen.reduce((sum, s) => sum + (s.dropInPriceCents ?? c.dropInPerSessionCents ?? 0), 0)
        if (each <= 0) return null
        return {
          kind: 'CLASS', classRunId: c.id, type: 'DROP_IN',
          sessionIds: chosen.map(s => s.id), dogIds: dogIds.length ? dogIds : [null],
          ticketTierId: null, ticketQuantity: 1,
          name: c.name,
          detail: `Drop-in · ${chosen.length} session${chosen.length === 1 ? '' : 's'}${dogSuffix}`,
          imageUrl: c.imageUrl,
          estimateCents: each * dogCount,
        }
      }
      if (!c.fullPriceCents || c.fullPriceCents <= 0) return null
      return {
        kind: 'CLASS', classRunId: c.id, type: 'FULL', sessionIds: [],
        dogIds: dogIds.length ? dogIds : [null], ticketTierId: null, ticketQuantity: 1,
        name: c.name, detail: `Full course${dogSuffix}`, imageUrl: c.imageUrl,
        estimateCents: c.fullPriceCents * dogCount,
      }
    }
    if (selection?.kind === 'event') {
      const e = selection.ev
      // A ticketed event is priced by its TIER × how many, never by the
      // package — the same rule the server enforces.
      const ticketed = e.tiers.length > 0
      const unit = ticketed ? (tier?.priceCents ?? 0) : (e.priceCents ?? 0)
      if (unit <= 0) return null
      if (ticketed && !tier) return null
      return {
        kind: 'CLASS', classRunId: e.id, type: 'FULL', sessionIds: [],
        // A ticket is a place at an event, not a dog's spot — one dog only.
        dogIds: ticketed ? (dogIds.length ? [dogIds[0]] : [null]) : (dogIds.length ? dogIds : [null]),
        ticketTierId: ticketed ? tier!.id : null,
        ticketQuantity: ticketed ? ticketQty : 1,
        name: e.name,
        detail: ticketed ? `${ticketQty} × ${tier!.name}` : `Event${dogSuffix}`,
        imageUrl: e.imageUrl,
        estimateCents: ticketed ? unit * ticketQty : unit * Math.max(1, dogIds.length),
      }
    }
    return null
  }

  function addToBasket() {
    const line = currentBasketLine()
    if (!basket || !line) return
    basket.add(line)
    // Straight back to the list — "continue shopping" is the whole point. The
    // pill in the corner is the confirmation; a done screen here would be a
    // dead end they'd have to back out of to add the next thing.
    setError(null)
    setSelection(null)
    setStep(1)
  }

  async function joinWaitlist() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/my/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg?.id ?? null }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not join the waitlist.')
        return
      }
      setDone('waitlisted')
    } finally {
      setSaving(false)
    }
  }

  async function confirm() {
    setError(null)
    setSaving(true)
    try {
      if (selection?.kind === 'session') {
        if (!date || !time) { setError('Pick an available time.'); return }
        const res = await fetch('/api/my/self-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: selection.pkg.id, startDate: toUtcIso(date, time, tz) }),
        })
        const b = await res.json().catch(() => ({}))
        if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not book.'); return }
        if (b.mode === 'payment' && b.url) { openExternal(b.url); return } // keep spinner while we leave for Stripe
        setDone(b.mode === 'booked' ? 'booked' : 'requested')
      } else if (selection?.kind === 'class') {
        if (classType === 'DROP_IN' && dropInSessionIds.length === 0) { setError('Pick which sessions to drop into.'); return }
        const res = await fetch(`/api/my/classes/${selection.cls.id}/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: classType, ...(dogIds.length ? { dogIds } : {}), sessionIds: classType === 'DROP_IN' ? dropInSessionIds : undefined }),
        })
        const b = await res.json().catch(() => ({}))
        if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not join.'); return }
        if (b.mode === 'payment' && b.url) { openExternal(b.url); return }
        setDone(b.mode === 'waitlisted' ? 'waitlisted' : 'enrolled')
      } else if (selection?.kind === 'event') {
        const e = selection.ev
        const ticketed = e.tiers.length > 0
        if (ticketed && !ticketTierId) { setError('Pick a ticket type.') ; return }
        // An event is one occasion, so it's always a FULL enrolment. When it
        // sells tickets the tier id is mandatory and the SERVER prices from it —
        // we never send an amount. When it doesn't, it's an ordinary group
        // booking and the dogs come along as usual.
        const res = await fetch(`/api/my/classes/${e.id}/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            ticketed
              ? { type: 'FULL', ticketTierId, quantity: ticketQty, ...(dogIds.length ? { dogIds: [dogIds[0]] } : {}) }
              : { type: 'FULL', ...(dogIds.length ? { dogIds } : {}) },
          ),
        })
        const b = await res.json().catch(() => ({}))
        if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not book that.'); return }
        if (b.mode === 'payment' && b.url) { openExternal(b.url); return }
        setDone(b.mode === 'waitlisted' ? 'waitlisted' : 'enrolled')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- success ----------
  if (done) {
    const copy: Record<DoneMode, { title: string; sub: string }> = {
      booked: { title: "You're booked in! 🎉", sub: `Your sessions with ${businessName} are on the calendar — see them in your Sessions tab.` },
      requested: { title: 'Request sent', sub: `${businessName} will confirm the time and you'll get a notification.` },
      enrolled: { title: ev ? "You're going! 🎉" : "You're enrolled! 🎉", sub: `See ${cls?.name ?? ev?.name ?? 'the class'} in your Sessions tab.` },
      waitlisted: { title: "You're on the waitlist", sub: `${businessName} will be in touch the moment a spot opens up.` },
    }
    return (
      <Shell step={null}>
        <div className="flex flex-col items-center text-center py-10">
          <div className="h-16 w-16 rounded-full bg-accent-soft flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-accent" />
          </div>
          <h2 className="mt-5 text-lg font-bold text-slate-900">{copy[done].title}</h2>
          <p className="mt-1.5 text-sm text-slate-500 max-w-xs leading-relaxed">{copy[done].sub}</p>
          <button
            onClick={() => { setDone(null); setSelection(null); setStep(1) }}
            className="mt-7 w-full max-w-xs rounded-2xl bg-slate-900 text-white text-sm font-semibold py-3.5 hover:bg-slate-800 transition-colors"
          >
            Done
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell step={nothingToBook ? null : step} onBack={step > 1 ? back : undefined}>
      {/* ---------- STEP 1 · choose ---------- */}
      {step === 1 && (
        nothingToBook ? (
          <EmptyState businessName={businessName} previewDays={previewDays} onWaitlist={joinWaitlist} saving={saving} error={error} />
        ) : (
          <div className="flex flex-col gap-6">
            {category === null ? (
              <>
                <StepIntro title="What would you like to book?" sub={`Choose what you'd like from ${businessName}.`} />
                <div className="flex flex-col gap-3">
                  {packages.length > 0 && (
                    <button type="button" onClick={() => setCategory('sessions')} className="group flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><CalendarPlus className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900">{term.oneToOne}</span><span className="block text-xs text-slate-500">{packages.length} available</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                    </button>
                  )}
                  {classes.length > 0 && (
                    <button type="button" onClick={() => setCategory('classes')} className="group flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><GraduationCap className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900">{term.classes}</span><span className="block text-xs text-slate-500">{classes.length} available</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                    </button>
                  )}
                  {events.length > 0 && (
                    <button type="button" onClick={() => setCategory('events')} className="group flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><PartyPopper className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900">{term.events}</span><span className="block text-xs text-slate-500">{events.length} coming up</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                    </button>
                  )}
                  {memberships.length > 0 && (
                    <button type="button" onClick={() => setCategory('memberships')} className="group flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Ticket className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900">{term.memberships}</span><span className="block text-xs text-slate-500">{memberships.length} available</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                    </button>
                  )}
                </div>

                {/* The trainer's tags, BELOW the types — a second way in, not a
                    replacement. Someone who came to book a class still finds
                    "Group classes" first; someone who came with a problem
                    ("I've got a new puppy") finds the tag. */}
                {tags.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <SectionLabel icon={<TagIcon className="h-3.5 w-3.5" />} text="Browse by tag" />
                    {tags.map(t => {
                      const count = t.packageIds.length + t.classIds.length + t.eventIds.length + t.productIds.length
                      return (
                        <button key={t.id} type="button" onClick={() => setCategory(`tag:${t.id}`)} className="group flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><TagIcon className="h-5 w-5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold text-slate-900">{t.name}</span>
                            <span className="block text-xs text-slate-500">{count} {count === 1 ? 'thing' : 'things'}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={() => setCategory(null)} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 self-start"><ChevronLeft className="h-4 w-4" /> All offerings</button>

            {/* A tag says its own name at the top, because the row that opened
                it is now off screen and "Puppy" is the answer the client came
                for — not "1-on-1 sessions". */}
            {activeTag && (
              <StepIntro title={activeTag.name} sub={`Everything ${businessName} has under this tag.`} />
            )}

            {(category === 'sessions' || activeTag) && shownPackages.length > 0 && (
              <section>
                <SectionLabel icon={<CalendarPlus className="h-3.5 w-3.5" />} text={term.oneToOne} />
                <div className="flex flex-col gap-2.5">
                  {shownPackages.map(p => (
                    <OfferingRow
                      key={p.id}
                      onClick={() => chooseSession(p)}
                      imageUrl={p.imageUrl}
                      title={p.name}
                      meta={<>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{p.durationMins} min</span>
                        <span className="inline-flex items-center gap-1">
                          {p.sessionType === 'VIRTUAL' ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                          {p.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'}
                        </span>
                        {p.sessionCount > 1 && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{p.sessionCount} sessions</span>}
                      </>}
                      price={price(p.priceCents, currency) ? <span className="text-sm font-semibold text-slate-900">{price(p.priceCents, currency)}</span> : null}
                    />
                  ))}
                </div>
              </section>
            )}

            {(category === 'classes' || activeTag) && shownClasses.length > 0 && (
              <section>
                <SectionLabel icon={<GraduationCap className="h-3.5 w-3.5" />} text={term.classes} />
                <div className="flex flex-col gap-2.5">
                  {shownClasses.map(c => {
                    const isFull = c.seatsLeft === 0
                    return (
                      <OfferingRow
                        key={c.id}
                        onClick={() => chooseClass(c)}
                        imageUrl={c.imageUrl}
                        title={c.name}
                        subtitle={c.packageName}
                        meta={<>
                          {c.scheduleNote && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{c.scheduleNote}</span>}
                          {c.seatsLeft != null && (
                            <span className={`inline-flex items-center gap-1 ${isFull ? 'text-amber-600' : ''}`}><Users className="h-3 w-3" />{isFull ? 'Full' : `${c.seatsLeft} left`}</span>
                          )}
                        </>}
                        price={price(c.fullPriceCents, currency) ? <span className="text-sm font-semibold text-slate-900">{price(c.fullPriceCents, currency)}</span> : null}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {(category === 'events' || activeTag) && shownEvents.length > 0 && (
              <section>
                <SectionLabel icon={<PartyPopper className="h-3.5 w-3.5" />} text={term.events} />
                <div className="flex flex-col gap-2.5">
                  {shownEvents.map(e => {
                    const isFull = e.seatsLeft === 0
                    // A ticketed event shows the CHEAPEST ticket, marked "from",
                    // and never the package price — that number is meaningless
                    // once tiers exist, and quoting it is how a $200 ticket got
                    // sold for $45.
                    const tierPrices = e.tiers.map(t => t.priceCents ?? 0)
                    const from = tierPrices.length > 0 ? Math.min(...tierPrices) : null
                    const label = from != null ? price(from, currency) : price(e.priceCents, currency)
                    return (
                      <OfferingRow
                        key={e.id}
                        onClick={() => chooseEvent(e)}
                        imageUrl={e.imageUrl}
                        title={e.name}
                        meta={<>
                          {fmtNextSession(e.startsAt, tz) && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{fmtNextSession(e.startsAt, tz)}</span>}
                          {e.seatsLeft != null && (
                            <span className={`inline-flex items-center gap-1 ${isFull ? 'text-amber-600' : ''}`}><Users className="h-3 w-3" />{isFull ? 'Full' : `${e.seatsLeft} left`}</span>
                          )}
                          {e.tiers.length > 1 && <span className="inline-flex items-center gap-1"><Ticket className="h-3 w-3" />{e.tiers.length} ticket types</span>}
                        </>}
                        price={label ? (
                          <span className="text-sm font-semibold text-slate-900">
                            {from != null && e.tiers.length > 1 ? <span className="text-xs font-normal text-slate-400">from </span> : null}{label}
                          </span>
                        ) : null}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {category === 'memberships' && memberships.length > 0 && (
              <section>
                <SectionLabel icon={<Ticket className="h-3.5 w-3.5" />} text={term.memberships} />
                <p className="text-xs text-slate-500 -mt-1 mb-2.5">Bundles from {businessName} — everything below is included.</p>
                {/* Checkout is its own flow (Stripe), so these cards buy directly
                    rather than continuing through the wizard's steps 2–3. */}
                <MembershipCards memberships={memberships} currency={currency ?? 'nzd'} />
              </section>
            )}

            {/* Products, ONLY inside a tag — and the reason the tag screen is
                one screen. The client sees "Puppy Foundations" and the puppy
                pack that goes with it in the same glance.

                They leave for the shop rather than being sold here: buying a
                thing has its own basket, stock, variants and delivery, and a
                second checkout living in the booking wizard would be a second
                one to keep right. The shop opens with this product's sheet
                already up, so it is one tap either way. */}
            {activeTag && shownProducts.length > 0 && (
              <section>
                <SectionLabel icon={<ShoppingBag className="h-3.5 w-3.5" />} text="From the shop" />
                <div className="flex flex-col gap-2.5">
                  {shownProducts.map(p => (
                    <a
                      key={p.id}
                      href={`/my-shop?product=${encodeURIComponent(p.id)}`}
                      className="group text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 hover:border-accent/40 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-11 w-11 rounded-xl object-cover shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-slate-900">{p.name}</p>
                          <p className="mt-1 text-xs text-slate-500">In the shop</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {price(p.priceCents, currency) && <span className="text-sm font-semibold text-slate-900">{price(p.priceCents, currency)}</span>}
                          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
              </>
            )}
          </div>
        )
      )}

      {/* ---------- STEP 2 · configure ---------- */}
      {step === 2 && pkg && (
        <SessionTimeStep
          pkg={pkg}
          availableDates={availableDates}
          timeOptions={timeOptions}
          date={date}
          time={time}
          onDate={setDate}
          onTime={setTime}
          onContinue={() => { setError(null); setStep(3) }}
          onWaitlist={joinWaitlist}
          saving={saving}
        />
      )}

      {step === 2 && cls && (
        <ClassOptionsStep
          tz={props.tz}
          cls={cls}
          currency={currency}
          acceptPayments={acceptPayments}
          dogs={dogs}
          dogIds={dogIds}
          onToggleDog={toggleDog}
          classType={classType}
          dropInSessionIds={dropInSessionIds}
          onSessionToggle={toggleSession}
          onSessionsSet={setDropInSessionIds}
          onContinue={() => { setError(null); setStep(3) }}
        />
      )}

      {step === 2 && ev && (
        <EventTicketStep
          tz={props.tz}
          ev={ev}
          currency={currency}
          acceptPayments={acceptPayments}
          dogs={dogs}
          dogIds={dogIds}
          onToggleDog={toggleDog}
          ticketTierId={ticketTierId}
          onTier={id => { setTicketTierId(id); setTicketQty(1) }}
          qty={ticketQty}
          onQty={setTicketQty}
          maxTicketQuantity={maxTicketQuantity}
          onContinue={() => { setError(null); setStep(3) }}
        />
      )}

      {/* ---------- STEP 3 · confirm ---------- */}
      {step === 3 && selection && (
        <ConfirmStep
          tz={props.tz}
          selection={selection}
          date={date}
          time={time}
          currency={currency}
          acceptPayments={acceptPayments}
          classType={classType}
          dropInSessionIds={dropInSessionIds}
          tier={tier}
          ticketQty={ticketQty}
          dogName={dogIds.length ? dogs.filter(d => dogIds.includes(d.id)).map(d => d.name).join(', ') : (dogs.find(d => d.id === dogId)?.name ?? null)}
          saving={saving}
          error={error}
          onConfirm={confirm}
          // Offered only when there IS a basket and this booking is something
          // it can hold — a priced class/event with payments switched on.
          onAddToBasket={basket && currentBasketLine() ? addToBasket : null}
          inBasket={!!basket && !!currentBasketLine() && basket.has(currentBasketLine()!)}
        />
      )}
    </Shell>
  )
}

/* ============================ layout shell ============================ */

// No business name or logo here — the app shell around this page already
// carries both, and repeating them pushed the actual booking below the fold.
// Only the back arrow survives, and only when there's somewhere to go back to.
function Shell({ step, onBack, children }: {
  step: 1 | 2 | 3 | null
  onBack?: () => void
  children: React.ReactNode
}) {
  const labels = ['Choose', 'Details', 'Confirm']
  return (
    <div className="px-4 pt-5 pb-10 max-w-xl mx-auto w-full">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="-ml-1.5 mb-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {step !== null && (
        <div className="flex items-center gap-2" aria-hidden="true">
          {labels.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3
            const active = n === step
            const doneStep = n < step
            return (
              // The last step takes no width of its own, so the bars before it
              // absorb the row and it finishes hard against the right edge.
              // With flex-1 on every step it sat at the left of its own cell,
              // which read as the track stopping short.
              <div key={label} className={`flex items-center gap-2 ${i < labels.length - 1 ? 'flex-1' : 'flex-none'}`}>
                <div className={`flex items-center gap-1.5 ${active || doneStep ? 'text-accent' : 'text-slate-300'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-accent text-accent-fg' : doneStep ? 'bg-accent-soft text-accent' : 'bg-slate-100 text-slate-400'}`}>
                    {doneStep ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide hidden sm:inline">{label}</span>
                </div>
                {/* A hairline in slate-100 is invisible against this panel —
                    there was a track, it just couldn't be seen. */}
                {i < labels.length - 1 && (
                  <div className={`h-1 flex-1 rounded-full ${doneStep ? 'bg-accent' : 'bg-slate-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-6">{children}</div>
    </div>
  )
}

function StepIntro({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{sub}</p>
    </div>
  )
}

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5 text-accent">
      {icon}
      <h2 className="text-xs font-bold uppercase tracking-wide">{text}</h2>
    </div>
  )
}

/**
 * One bookable thing, as a row. Used by 1:1s, classes and events alike — the
 * three had the same markup copied three times, so a change to one of them
 * (this one: the picture) had to be made three times to hold.
 *
 * The picture sits hard against the right edge and fills the row's height. It
 * used to be an 11px-square thumbnail inset by the card's own padding, which
 * left it floating in white with rounded corners of its own. The padding now
 * belongs to the text, not to the card, so the image can reach the edge.
 *
 * On the right rather than the left deliberately (Karl, 2026-08-06): the text
 * then starts in the same place whether or not there IS a picture, so a
 * trainer who has uploaded none still gets a straight left margin down the list.
 */
function OfferingRow({ onClick, imageUrl, title, subtitle, meta, price }: {
  onClick: () => void
  imageUrl: string | null
  title: string
  subtitle?: string | null
  meta: React.ReactNode
  price?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 p-4">
          <p className="text-[15px] font-semibold text-slate-900">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">{meta}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 py-4 pr-4">
          {price}
          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-accent transition-colors" />
        </div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-24 self-stretch object-cover shrink-0" />
        )}
      </div>
    </button>
  )
}

/* ============================ step 2 · session time ============================ */

function SessionTimeStep({ pkg, availableDates, timeOptions, date, time, onDate, onTime, onContinue, onWaitlist, saving }: {
  pkg: WizardPackage
  availableDates: string[]
  timeOptions: string[]
  date: string
  time: string
  onDate: (d: string) => void
  onTime: (t: string) => void
  onContinue: () => void
  onWaitlist: () => void
  saving: boolean
}) {
  const noDays = availableDates.length === 0
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Pick a time" sub={`${pkg.name} · ${pkg.durationMins} min${pkg.sessionCount > 1 ? ` · ${pkg.sessionCount} sessions, every ${pkg.weeksBetween} week${pkg.weeksBetween === 1 ? '' : 's'}` : ''}`} />

      {noDays ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 text-center">
          <p className="text-sm text-slate-600">No open times in the next four weeks.</p>
          {/* Only offer the waitlist if the trainer keeps one for this package —
              otherwise it's a promise of a call-back nobody agreed to make. */}
          {pkg.allowWaitlist && (
            <button onClick={onWaitlist} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 text-sm font-medium px-4 py-2 hover:bg-white disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Join the waitlist instead
            </button>
          )}
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Choose a day</p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {availableDates.map(d => {
                const on = d === date
                return (
                  <button key={d} onClick={() => onDate(d)} className={`flex-none w-[54px] rounded-2xl py-2.5 text-center border transition-colors ${on ? 'bg-accent border-accent text-accent-fg' : 'bg-white border-slate-200 text-slate-900 hover:border-accent/40'}`}>
                    <span className={`block text-[10px] font-bold uppercase ${on ? 'text-accent-fg/80' : 'text-slate-400'}`}>{fmtWeekday(d)}</span>
                    <span className="block text-lg font-bold leading-tight">{fmtDayNum(d)}</span>
                    <span className={`block text-[9px] font-semibold uppercase ${on ? 'text-accent-fg/70' : 'text-slate-300'}`}>{fmtMonth(d)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{date ? `${fmtFullDate(date)} · ${timeOptions.length} open` : 'Start time'}</p>
            {timeOptions.length === 0 ? (
              <p className="text-sm text-slate-500 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">No times left this day — try another.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {timeOptions.map(t => {
                  const on = t === time
                  return (
                    <button key={t} onClick={() => onTime(t)} className={`rounded-xl py-2.5 text-sm font-semibold tabular-nums border transition-colors ${on ? 'bg-accent border-accent text-accent-fg' : 'border-accent/30 text-accent hover:bg-accent-soft'}`}>
                      {fmtTimeLabel(t)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!noDays && (
        <StickyCta disabled={!time} onClick={onContinue}>
          {time ? `Continue · ${fmtTimeLabel(time)}` : 'Pick a time'}
        </StickyCta>
      )}
    </div>
  )
}

/* ============================ step 2 · class options ============================ */

function ClassOptionsStep({ cls, tz, currency, acceptPayments, dogs, dogIds, onToggleDog, classType, dropInSessionIds, onSessionToggle, onSessionsSet, onContinue }: {
  tz: string
  cls: WizardClass
  currency: string | null
  acceptPayments: boolean
  dogs: { id: string; name: string }[]
  dogIds: string[]
  onToggleDog: (id: string) => void
  classType: 'FULL' | 'DROP_IN'
  dropInSessionIds: string[]
  onSessionToggle: (id: string) => void
  /** Replace the whole selection — Select all / Clear all. */
  onSessionsSet: (ids: string[]) => void
  onContinue: () => void
}) {
  const isFull = cls.seatsLeft === 0
  const paidButNoPayments = !!cls.fullPriceCents && !acceptPayments
  const dropping = classType === 'DROP_IN'
  // Drop-ins pick sessions; the whole class being "full" for the term doesn't
  // block a single session that still has room.
  const needsSession = dropping && dropInSessionIds.length === 0

  return (
    <div className="flex flex-col gap-5">
      <StepIntro title={cls.name} sub={cls.packageName} />

      {/* Only when there's something to put in it. A class with no schedule
          note and no capacity has neither row, and the card was rendering as
          an empty white box above the schedule. */}
      {(cls.scheduleNote || (!dropping && cls.seatsLeft != null)) && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex flex-col gap-2.5 text-sm">
          {cls.scheduleNote && <Row icon={<CalendarDays className="h-4 w-4" />} text={cls.scheduleNote} />}
          {!dropping && cls.seatsLeft != null && <Row icon={<Users className="h-4 w-4" />} text={isFull ? (cls.allowWaitlist ? 'Full — join the waitlist' : 'Full') : `${cls.seatsLeft} spot${cls.seatsLeft === 1 ? '' : 's'} left`} />}
        </div>
      )}

      {/* The one place a class's sessions are shown. Read-only for a full
          course; the SAME calendar becomes the picker when dropping in — one
          component, so the client never learns two different layouts. */}
      {cls.sessions.length > 0 && (
        <SessionCalendar
          // Keyed on the run: the month it is paged to and the day it is open
          // on are about THIS class, and backing out to pick another one has to
          // start it over rather than land on August of a term that ended.
          key={cls.id}
          tz={tz}
          currency={currency}
          sessions={cls.sessions}
          picking={dropping}
          selectedIds={dropInSessionIds}
          onToggle={onSessionToggle}
          onSet={onSessionsSet}
        />
      )}

      {dogs.length > 1 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Which dogs? <span className="font-normal normal-case text-slate-400">Tap more than one to book them together</span></p>
          <div className="flex flex-wrap gap-2">
            {dogs.map(d => (
              <button key={d.id} onClick={() => onToggleDog(d.id)} className={`rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${dogIds.includes(d.id) ? 'bg-accent border-accent text-accent-fg' : 'bg-white border-slate-200 text-slate-700 hover:border-accent/40'}`}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {paidButNoPayments ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-500">
          This class needs payment, which isn&apos;t switched on yet — ask to be enrolled.
        </div>
      ) : dropping ? (
        <StickyCta disabled={needsSession} onClick={onContinue}>
          {needsSession
            ? 'Pick your sessions above'
            : `Continue · ${dropInSessionIds.length} session${dropInSessionIds.length === 1 ? '' : 's'}`}
        </StickyCta>
      ) : (
        <StickyCta disabled={isFull && !cls.allowWaitlist} onClick={onContinue}>
          {isFull ? (cls.allowWaitlist ? 'Continue to waitlist' : 'Class is full') : 'Continue'}
        </StickyCta>
      )}
    </div>
  )
}

/* ============================ session calendar ============================ */

const WEEKDAY_INITIALS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/**
 * A month calendar over a class run's sessions, with the chosen day's sessions
 * underneath it and every pick listed at the bottom.
 *
 * WHY IT ISN'T A LIST ANY MORE. This used to render one row per upcoming
 * session. That is fine for an eight-week course and unusable for a casual
 * class: the trainer's rolling horizon put 180 sessions on a real Waggy Tails
 * run, which came out as 180 tap targets and 10,765px of page on a 390px phone
 * — about thirteen screens of one flat list. A month grid says the same thing
 * in one screen because a casual class is a PATTERN ("Tuesdays and Thursdays"),
 * and a grid is what a pattern looks like.
 *
 * WHY THE PICKS ARE LISTED SEPARATELY. Multi-select is the point — a client
 * buys four Saturdays in one go. Paging to October must not lose sight of the
 * two August dates already chosen, so the picks are derived from the whole run
 * rather than from the month on screen, and they carry their own total. A
 * picker that hides the selection would be a worse bug than the wall.
 *
 * REJECTED: a FullScreenSheet over the class screen. Step 2 already IS a full
 * screen; an overlay on top of it is a screen over a screen, and it would have
 * put the picks behind a "done" button instead of beside the CTA that uses them.
 */
function SessionCalendar({ tz, currency, sessions, picking, selectedIds, onToggle, onSet }: {
  tz: string
  currency: string | null
  sessions: WizardClass['sessions']
  /** True when the client is choosing sessions; false = read-only schedule. */
  picking: boolean
  selectedIds: string[]
  onToggle: (id: string) => void
  /** Replace the whole selection — Select all / Clear all. */
  onSet: (ids: string[]) => void
}) {
  const days = useMemo(() => groupSessionsByDay(sessions, tz), [sessions, tz])
  const months = useMemo(() => monthsWithSessions(days), [days])
  const byDate = useMemo(() => new Map(days.map(d => [d.dateStr, d])), [days])
  const bookableIds = useMemo(() => allSelectableIds(days), [days])

  const firstDay = useMemo(() => defaultOpenDay(days), [days])
  const [openDay, setOpenDay] = useState<string | null>(firstDay)
  const [month, setMonth] = useState<string>(firstDay ? monthOf(firstDay) : (months[0] ?? ''))

  const monthIdx = months.indexOf(month)
  const prevMonth = monthIdx > 0 ? months[monthIdx - 1] : null
  const nextMonth = monthIdx >= 0 && monthIdx < months.length - 1 ? months[monthIdx + 1] : null
  const weeks = useMemo(() => (month ? monthGrid(month) : []), [month])

  const day = openDay ? byDate.get(openDay) ?? null : null
  const picked = useMemo(() => selectedInOrder(days, selectedIds), [days, selectedIds])
  const allPicked = bookableIds.length > 0 && selectedIds.length === bookableIds.length
  const totalCents = picked.reduce((sum, p) => sum + (p.session.dropInPriceCents ?? 0), 0)

  // Paging to a month drops onto its first day with something on, so the panel
  // underneath is never empty after an arrow tap.
  function goMonth(to: string | null) {
    if (!to) return
    setMonth(to)
    const first = days.find(d => monthOf(d.dateStr) === to && d.selectableCount > 0)
      ?? days.find(d => monthOf(d.dateStr) === to)
    if (first) setOpenDay(first.dateStr)
  }

  return (
    // A query container: this sits in the wizard's centred column, which is far
    // narrower than the window once the desktop rail takes its 17rem. The picks
    // spread to two columns off THIS width, never the viewport's.
    <div className="@container">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {picking ? 'Pick the sessions you want' : 'Session schedule'} <span className="text-slate-300">· {sessions.length}</span>
        </p>
        {/* Taking the whole course IS ticking every session — one control
            rather than a separate full-course mode to find first. Only what's
            actually bookable: sessions they hold or that are full aren't on
            offer. */}
        {picking && bookableIds.length > 0 && (
          <button
            type="button"
            onClick={() => onSet(allPicked ? [] : bookableIds)}
            className="shrink-0 text-xs font-semibold text-accent hover:underline"
          >
            {allPicked ? 'Clear all' : `Select all ${bookableIds.length}`}
          </button>
        )}
      </div>

      {/* ONE bordered surface with hairlines through it — the month, the day
          it opens onto and the picks are three parts of one decision, not
          three floating cards. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-2">
          <button
            type="button"
            onClick={() => goMonth(prevMonth)}
            disabled={!prevMonth}
            aria-label="Previous month"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-25"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <p aria-live="polite" className="text-sm font-semibold text-slate-900">{month ? monthLabel(month) : ''}</p>
          <button
            type="button"
            onClick={() => goMonth(nextMonth)}
            disabled={!nextMonth}
            aria-label="Next month"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-25"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-2 pb-2 pt-1">
          <div className="grid grid-cols-7">
            {WEEKDAY_INITIALS.map(w => (
              <div key={w} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {weeks.flat().map(dateStr => {
              const d = byDate.get(dateStr) ?? null
              const inMonth = monthOf(dateStr) === month
              const picks = d ? picksOnDay(d, selectedIds) : 0
              const open = dateStr === openDay
              const spare = (d?.selectableCount ?? 0) > 0
              return (
                <button
                  key={dateStr}
                  type="button"
                  disabled={!d}
                  // A grid row spills into the neighbouring month, and those
                  // days are real. Tapping one moves the header with it —
                  // otherwise the panel says "Tue 1 Sep" under a title that
                  // still reads August.
                  onClick={() => {
                    setOpenDay(dateStr)
                    if (!inMonth && months.includes(monthOf(dateStr))) setMonth(monthOf(dateStr))
                  }}
                  aria-pressed={open}
                  aria-label={d
                    ? `${fmtFullDate(dateStr)} — ${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'}${picks > 0 ? `, ${picks} picked` : spare ? '' : ', none left'}`
                    : fmtFullDate(dateStr)}
                  // Square on a phone, capped once the column has room —
                  // otherwise a 544px column gives 75px cells and the month
                  // alone is taller than the screen it is meant to save.
                  className={`flex aspect-square max-h-14 flex-col items-center justify-center rounded-lg text-sm tabular-nums transition-colors ${
                    open
                      ? 'bg-accent font-bold text-accent-fg'
                      : picks > 0
                        ? 'font-semibold text-slate-900 ring-1 ring-inset ring-accent hover:bg-slate-50'
                        : d
                          // A spilled day, and a day with nothing left on it,
                          // both stay lighter — so the current month reads as
                          // one block and "there's room here" reads at a glance.
                          ? `font-semibold hover:bg-slate-50 ${inMonth && spare ? 'text-slate-900' : 'text-slate-400'}`
                          : `${inMonth ? 'text-slate-300' : 'text-slate-200'} cursor-default`
                  }`}
                >
                  <span>{Number(dateStr.slice(8))}</span>
                  {/* A dot row rather than a number: at a glance you want "is
                      anything on, and have I picked it", not a count. */}
                  <span className="mt-0.5 flex h-1.5 items-center gap-[3px]">
                    {picks > 0
                      ? Array.from({ length: Math.min(picks, 3) }).map((_, i) => (
                          <span key={i} className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-accent-fg' : 'bg-accent'}`} />
                        ))
                      : d && (
                          <span className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-accent-fg/60' : spare ? 'bg-slate-300' : 'bg-slate-200'}`} />
                        )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* The chosen day, opened out. 2–3 sessions is the real shape of a
            casual class day, so this is short by construction. */}
        {day && (
          <div className="border-t border-slate-100">
            <p className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-slate-400">
              {fmtFullDate(day.dateStr)} <span className="text-slate-300">· {day.sessions.length} session{day.sessions.length === 1 ? '' : 's'}</span>
            </p>
            <div>
              {day.sessions.map(s => {
                const full = s.spacesLeft === 0
                const mine = s.booked
                const selected = picking && selectedIds.includes(s.id)
                const priceLabel = price(s.dropInPriceCents, currency)
                const time = fmtTimeInTz(s.at, tz)
                const inner = (
                  <>
                    {picking && (
                      // A checkbox, not a badge. Several can be on at once, so
                      // each row has to say whether it is in — and a tick box is
                      // the one control everybody already reads that way.
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        selected ? 'border-accent bg-accent text-accent-fg' : mine ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-slate-300'
                      }`}>
                        {(selected || mine) && <Check className="h-4 w-4" strokeWidth={1.75} />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums text-slate-900">{time}</span>
                      {s.title && <span className="block truncate text-xs text-slate-500">{s.title}</span>}
                    </span>
                    {picking && mine ? (
                      <span className="shrink-0 text-xs font-semibold text-emerald-700">You&apos;re booked</span>
                    ) : picking ? (
                      <span className="shrink-0 text-right">
                        {priceLabel && <span className="block text-sm font-semibold text-slate-900">{priceLabel}</span>}
                        <span className={`block text-xs ${full ? 'text-rose-500' : 'text-slate-500'}`}>
                          {s.spacesLeft == null ? `${s.durationMins} min` : full ? 'Full' : `${s.spacesLeft} left`}
                        </span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-500">{s.durationMins} min</span>
                    )}
                  </>
                )
                return picking ? (
                  <button
                    key={s.id}
                    type="button"
                    disabled={full || mine}
                    onClick={() => onToggle(s.id)}
                    // The action leads the label so a screen reader — and a
                    // test — can find "the next one I can add" without parsing
                    // a price out of it.
                    aria-label={`${mine ? "You're booked" : full ? 'Full' : selected ? 'Remove' : 'Add'} ${fmtFullDate(day.dateStr)} ${time}`}
                    className={`flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition-colors first:border-t-0 ${
                      selected ? 'bg-accent-soft' : mine ? 'cursor-default' : 'hover:bg-slate-50'
                    } ${mine ? '' : 'disabled:cursor-not-allowed disabled:opacity-40'}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={s.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
                    {inner}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Everything picked, whatever month it is in — the answer to "which
            four did I choose?" without paging back to look. */}
        {picking && picked.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/60">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                You&apos;ve picked {picked.length}
              </p>
              <button type="button" onClick={() => onSet([])} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                Clear all
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-x-4 px-4 pb-2 @md:grid-cols-2">
              {picked.map(({ dateStr, session }) => (
                <li key={session.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {fmtFullDate(dateStr)} · <span className="tabular-nums">{fmtTimeInTz(session.at, tz)}</span>
                  </span>
                  {price(session.dropInPriceCents, currency) && (
                    <span className="shrink-0 tabular-nums text-slate-500">{price(session.dropInPriceCents, currency)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggle(session.id)}
                    aria-label={`Remove ${fmtFullDate(dateStr)} ${fmtTimeInTz(session.at, tz)}`}
                    className="-mr-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
            {totalCents > 0 && (
              <div className="flex items-center justify-between gap-4 border-t border-slate-200/70 px-4 py-2.5">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Total</span>
                <span className="text-sm font-bold tabular-nums text-slate-900">{price(totalCents, currency)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================ step 2 · event tickets ============================ */

// An event is one occasion, so there is no day to pick — the only decisions are
// which ticket type and how many (and, for an un-ticketed event, which dogs).
// The tier list is mandatory when the event has tiers: /enroll refuses a
// ticketed event that doesn't name one, and refuses it BEFORE taking any money.
function EventTicketStep({ ev, tz, currency, acceptPayments, dogs, dogIds, onToggleDog, ticketTierId, onTier, qty, onQty, maxTicketQuantity, onContinue }: {
  tz: string
  ev: WizardEvent
  currency: string | null
  acceptPayments: boolean
  dogs: { id: string; name: string }[]
  dogIds: string[]
  onToggleDog: (id: string) => void
  ticketTierId: string | null
  onTier: (id: string) => void
  qty: number
  onQty: (n: number) => void
  maxTicketQuantity: number
  onContinue: () => void
}) {
  const ticketed = ev.tiers.length > 0
  const tier = ev.tiers.find(t => t.id === ticketTierId) ?? null
  const isFull = ev.seatsLeft === 0
  const soldOut = ticketed && ev.tiers.every(t => t.spacesLeft === 0)
  // Never offer more than the tier has left, nor more than the API accepts.
  const qtyMax = Math.max(1, Math.min(tier?.spacesLeft ?? maxTicketQuantity, maxTicketQuantity))
  const chargeable = ticketed ? (tier?.priceCents ?? 0) * qty : (ev.priceCents ?? 0)
  const paidButNoPayments = chargeable > 0 && !acceptPayments

  return (
    <div className="flex flex-col gap-5">
      <StepIntro title={ev.name} sub={ev.packageName} />

      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4 flex flex-col gap-2.5 text-sm">
        {fmtNextSession(ev.startsAt, tz) && <Row icon={<CalendarDays className="h-4 w-4" />} text={fmtNextSession(ev.startsAt, tz)!} />}
        {ev.durationMins != null && <Row icon={<Clock className="h-4 w-4" />} text={`${ev.durationMins} min`} />}
        {ev.scheduleNote && <Row icon={<Repeat className="h-4 w-4" />} text={ev.scheduleNote} />}
        {ev.seatsLeft != null && <Row icon={<Users className="h-4 w-4" />} text={isFull ? (ev.allowWaitlist ? 'Full — join the waitlist' : 'Full') : `${ev.seatsLeft} place${ev.seatsLeft === 1 ? '' : 's'} left`} />}
      </div>

      {ticketed && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Which ticket?</p>
          <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
            {ev.tiers.map(t => {
              const out = t.spacesLeft === 0
              const on = t.id === ticketTierId
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={out}
                  onClick={() => onTier(t.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-t border-slate-100 first:border-t-0 text-left transition-colors ${on ? 'bg-accent-soft' : 'hover:bg-slate-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${on ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'}`}>
                    {on ? <Check className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{t.name}</span>
                    {t.spacesLeft != null && (
                      <span className={`block text-xs ${out ? 'text-rose-500' : 'text-emerald-600'}`}>{out ? 'Sold out' : `${t.spacesLeft} left`}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-slate-900">{price(t.priceCents, currency) ?? 'Free'}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {ticketed && tier && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">How many?</p>
          <div className="flex items-center gap-4">
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white">
              <button type="button" aria-label="One fewer ticket" disabled={qty <= 1} onClick={() => onQty(Math.max(1, qty - 1))} className="h-11 w-11 grid place-items-center text-slate-600 disabled:opacity-30">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-sm font-bold tabular-nums text-slate-900">{qty}</span>
              <button type="button" aria-label="One more ticket" disabled={qty >= qtyMax} onClick={() => onQty(Math.min(qtyMax, qty + 1))} className="h-11 w-11 grid place-items-center text-slate-600 disabled:opacity-30">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className="text-sm text-slate-500">
              {price((tier.priceCents ?? 0) * qty, currency)} total
            </span>
          </div>
        </div>
      )}

      {/* Only an un-ticketed event books per dog. A ticket is a place at the
          event, and one owner can buy several — the API bills the tickets, not
          the dogs, so offering a multi-dog picker here would just mislead. */}
      {!ticketed && dogs.length > 1 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Which dogs? <span className="font-normal normal-case text-slate-400">Tap more than one to book them together</span></p>
          <div className="flex flex-wrap gap-2">
            {dogs.map(d => (
              <button key={d.id} onClick={() => onToggleDog(d.id)} className={`rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${dogIds.includes(d.id) ? 'bg-accent border-accent text-accent-fg' : 'bg-white border-slate-200 text-slate-700 hover:border-accent/40'}`}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {paidButNoPayments ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-500">
          This event needs payment, which isn&apos;t switched on yet — ask to be booked in.
        </div>
      ) : soldOut ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-500">
          Every ticket type is sold out.
        </div>
      ) : (
        <StickyCta disabled={(ticketed && !tier) || (isFull && !ev.allowWaitlist)} onClick={onContinue}>
          {isFull
            ? (ev.allowWaitlist ? 'Continue to waitlist' : 'Event is full')
            : ticketed
              ? (tier ? `Continue · ${qty} × ${tier.name}` : 'Pick a ticket type')
              : 'Continue'}
        </StickyCta>
      )}
    </div>
  )
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-slate-600">
      <span className="text-accent">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

/* ============================ step 3 · confirm ============================ */

function ConfirmStep({ selection, tz, date, time, currency, acceptPayments, classType, dropInSessionIds, tier, ticketQty, dogName, saving, error, onConfirm, onAddToBasket, inBasket }: {
  tz: string
  selection: Selection
  date: string
  time: string
  currency: string | null
  acceptPayments: boolean
  classType: 'FULL' | 'DROP_IN'
  dropInSessionIds: string[]
  tier: WizardEventTier | null
  ticketQty: number
  dogName: string | null
  saving: boolean
  error: string | null
  onConfirm: () => void
  /** Null when this booking can't go in a basket (free, or a 1:1 time slot). */
  onAddToBasket: (() => void) | null
  inBasket: boolean
}) {
  const isSession = selection.kind === 'session'
  const pkg = selection.kind === 'session' ? selection.pkg : null
  const cls = selection.kind === 'class' ? selection.cls : null
  const ev = selection.kind === 'event' ? selection.ev : null
  const dropInSessions = cls && classType === 'DROP_IN' ? cls.sessions.filter(s => dropInSessionIds.includes(s.id)) : []

  // A drop-in can't be "full" — it only exists once a session has room.
  const isFull = ev ? ev.seatsLeft === 0 : classType === 'FULL' && cls?.seatsLeft === 0
  // Each session is charged at its own rate, which can differ session to
  // session, so several sessions is the SUM — not one price shown for what's
  // actually three bookings. Falls back to the class's headline rate.
  const priceCents = isSession
    ? pkg!.priceCents
    : ev
      // A ticketed event is priced by its TICKET × how many, exactly as the
      // server does it. ev.priceCents is null whenever tiers exist, so the
      // package price can never leak into this quote.
      ? (ev.tiers.length > 0 ? (tier ? (tier.priceCents ?? 0) * ticketQty : null) : ev.priceCents)
      : classType === 'DROP_IN'
        ? dropInSessions.reduce<number | null>(
            (sum, s) => {
              const p = s.dropInPriceCents ?? cls!.dropInPerSessionCents
              return p == null ? sum : (sum ?? 0) + p
            },
            null,
          )
        : cls!.fullPriceCents
  const needsApproval = isSession && pkg!.selfBookRequiresApproval
  const priceLabel = price(priceCents, currency)

  // Whether confirming will pop the card box (Stripe Checkout). Only when it's an
  // instant (auto-approve) priced booking AND the trainer takes cards. Otherwise
  // it books now and the trainer invoices later — no payment box.
  const willCharge = !!priceCents && acceptPayments && !needsApproval && !isFull

  let ctaText: string
  if (isSession) ctaText = needsApproval ? 'Request booking' : willCharge ? `Pay ${priceLabel} & book` : 'Confirm booking'
  else if (isFull) ctaText = 'Join waitlist'
  else if (ev) ctaText = willCharge ? `Pay ${priceLabel} & book` : 'Confirm my place'
  else ctaText = willCharge ? `Pay ${priceLabel} & join` : 'Confirm & join'

  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Confirm your booking" sub="One last look before it's locked in." />

      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100">
          <p className="text-[15px] font-bold text-slate-900">{isSession ? pkg!.name : ev ? ev.name : cls!.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{isSession ? (pkg!.sessionType === 'VIRTUAL' ? 'Virtual session' : 'In-person session') : ev ? ev.packageName : cls!.packageName}</p>
        </div>
        <dl className="divide-y divide-slate-100">
          {ev ? (
            <>
              {fmtNextSession(ev.startsAt, tz) && <SummaryRow label="When" value={fmtNextSession(ev.startsAt, tz)!} />}
              {ev.durationMins != null && <SummaryRow label="Length" value={`${ev.durationMins} min`} />}
              {ev.scheduleNote && <SummaryRow label="Details" value={ev.scheduleNote} />}
              {tier && <SummaryRow label="Ticket" value={ticketQty > 1 ? `${ticketQty} × ${tier.name}` : tier.name} />}
            </>
          ) : isSession ? (
            <>
              <SummaryRow label="When" value={`${fmtFullDate(date)} · ${fmtTimeLabel(time)}`} />
              <SummaryRow label="Length" value={`${pkg!.durationMins} min`} />
              {pkg!.sessionCount > 1 && <SummaryRow label="Sessions" value={`${pkg!.sessionCount}, every ${pkg!.weeksBetween} week${pkg!.weeksBetween === 1 ? '' : 's'}`} />}
            </>
          ) : (
            <>
              {cls!.scheduleNote && <SummaryRow label="Schedule" value={cls!.scheduleNote} />}
              <SummaryRow
                label="Type"
                value={classType === 'DROP_IN'
                  ? `Drop-in · ${dropInSessions.length} session${dropInSessions.length === 1 ? '' : 's'}`
                  : 'Full course'}
              />
              {/* Every session they're paying for, listed — the total below
                  covers all of them, so it has to be clear what's in it. */}
              {classType === 'DROP_IN'
                ? dropInSessions.map((s, i) => (
                    <SummaryRow
                      key={s.id}
                      label={i === 0 ? (dropInSessions.length === 1 ? 'Session' : 'Sessions') : ''}
                      value={fmtNextSession(s.at, tz) ?? ''}
                    />
                  ))
                : fmtNextSession(cls!.nextSessionAt, tz) && <SummaryRow label="Starts" value={fmtNextSession(cls!.nextSessionAt, tz)!} />}
            </>
          )}
          {/* A ticket is a place, not a dog's spot — don't imply otherwise. */}
          {dogName && !(ev && ev.tiers.length > 0) && <SummaryRow label="Dog" value={dogName} />}
          <SummaryRow label="Price" value={priceLabel ?? 'Free'} strong />
        </dl>
      </div>

      {needsApproval && (
        <p className="text-xs text-slate-500 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
          This trainer approves bookings first — you won&apos;t be charged until they confirm the time.
        </p>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <StickyCta disabled={saving} onClick={onConfirm} loading={saving}>{ctaText}</StickyCta>

      {/* Only offered where it changes anything: a booking that would otherwise
          send them to the card box on its own. Underneath the primary action,
          because paying now is still the common case — this is for the client
          who is also buying a lead, or booking two more Saturdays. */}
      {willCharge && onAddToBasket && (
        <button
          type="button"
          onClick={onAddToBasket}
          className="-mt-1 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3.5 text-[15px] font-semibold text-slate-700"
        >
          {inBasket ? (
            <><Check className="h-4 w-4" strokeWidth={1.75} /> In your basket — add again</>
          ) : (
            <><ShoppingBag className="h-4 w-4" strokeWidth={1.75} /> Add to basket &amp; keep browsing</>
          )}
        </button>
      )}
    </div>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className={`text-sm text-right ${strong ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{value}</dd>
    </div>
  )
}

/* ============================ empty state ============================ */

function EmptyState({ businessName, previewDays, onWaitlist, saving, error }: {
  businessName: string
  previewDays: PreviewDay[]
  onWaitlist: () => void
  saving: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-accent-soft flex items-center justify-center">
          <CalendarPlus className="h-6 w-6 text-accent" />
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-700">Nothing to self-book right now</p>
        <p className="mt-1 text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
          {businessName} hasn&apos;t opened any sessions, classes or events for self-booking yet. Join the waitlist and they&apos;ll reach out.
        </p>
        <button onClick={onWaitlist} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent text-accent-fg text-sm font-semibold px-5 py-2.5 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Join the waitlist
        </button>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {previewDays.length > 0 && (
        <section>
          <SectionLabel icon={<Clock className="h-3.5 w-3.5" />} text="Their open times" />
          <div className="flex flex-col gap-2">
            {previewDays.map((d, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-white border border-slate-100 px-4 py-3">
                <div className="w-16 shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{d.weekday}</p>
                  <p className="text-xs text-slate-400">{d.dayLabel}</p>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {d.ranges.map((r, j) => (
                    <li key={j} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft text-accent px-2.5 py-1 text-xs font-medium tabular-nums">
                      <Clock className="h-3 w-3" />{r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================ primary CTA ============================ */

// Full-width, in-flow action button. Sits at the end of each step's content so
// it stays aligned to the wizard's content column and never slides under the
// desktop sidebar or over the mobile bottom-tab bar.
function StickyCta({ children, disabled, loading, onClick }: { children: React.ReactNode; disabled?: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-1 w-full rounded-2xl bg-accent text-accent-fg text-[15px] font-semibold py-3.5 shadow-[0_6px_20px_rgba(15,31,36,0.14)] disabled:opacity-40 inline-flex items-center justify-center gap-2 transition-opacity"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
