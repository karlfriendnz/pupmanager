// Calendly-style slot generation for the public booking page. Slices a
// trainer's declared AvailabilitySlots into discrete bookable start-times of
// `slotLengthMins`, stepped by `slotIntervalMins`, removing blackout days,
// times that collide with existing UPCOMING sessions, and anything inside the
// `minNoticeHours` cut-off. Shared by the public page (initial render), the
// GET slots endpoint (refresh), and the POST endpoint (re-validate a pick),
// so all three agree on exactly which slots exist.
import { prisma } from './prisma'
import {
  slotAppliesOnDate,
  isBlackoutDate,
  type AvailabilityRow,
  type BlackoutRow,
} from './availability'
import { zonedToUtc } from './timezone'

export interface BookingSlot {
  /** UTC ISO instant of the slot start — what the client submits back. */
  iso: string
  /** Trainer-local YYYY-MM-DD the slot falls on. */
  dateStr: string
  /** Minutes from local midnight (slot start). */
  startMin: number
  /** Display label, e.g. "2:00 PM". */
  label: string
}

export interface DaySlots {
  dateStr: string
  slots: BookingSlot[]
}

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

function parseHM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function fmt12(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

interface GenerateArgs {
  tz: string
  todayStr: string
  windowDays: number
  slotLengthMins: number
  slotIntervalMins: number
  minNoticeHours: number
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  /** Existing busy ranges keyed by trainer-local YYYY-MM-DD (minutes). */
  busyByDate: Map<string, { start: number; end: number }[]>
  now: Date
}

/** Pure slot generator — no DB. Exported for direct testing. */
export function generateBookingSlots(args: GenerateArgs): DaySlots[] {
  const length = Math.max(1, args.slotLengthMins)
  const interval = Math.max(1, args.slotIntervalMins)
  const earliest = new Date(args.now.getTime() + args.minNoticeHours * 60 * 60 * 1000)

  const out: DaySlots[] = []
  for (let i = 0; i < args.windowDays; i++) {
    const dateStr = addDayStr(args.todayStr, i)
    if (isBlackoutDate(args.blackouts, dateStr)) continue

    const isoDow = dayOfWeekIso(dateStr)
    const applicable = args.slots.filter(s => slotAppliesOnDate(s, dateStr, isoDow))
    if (applicable.length === 0) continue

    const busy = args.busyByDate.get(dateStr) ?? []
    const [y, mo, d] = dateStr.split('-').map(Number)

    // Collect candidate starts across every applicable availability window,
    // deduped — overlapping windows shouldn't double-list the same time.
    const starts = new Set<number>()
    for (const slot of applicable) {
      const open = parseHM(slot.startTime)
      const close = parseHM(slot.endTime)
      for (let s = open; s + length <= close; s += interval) starts.add(s)
    }

    const daySlots: BookingSlot[] = []
    for (const s of [...starts].sort((a, b) => a - b)) {
      const end = s + length
      // Drop if it collides with an existing session.
      if (busy.some(b => b.start < end && s < b.end)) continue
      const utc = zonedToUtc(y, mo, d, Math.floor(s / 60), s % 60, args.tz)
      if (utc.getTime() < earliest.getTime()) continue
      daySlots.push({ iso: utc.toISOString(), dateStr, startMin: s, label: fmt12(s) })
    }

    if (daySlots.length > 0) out.push({ dateStr, slots: daySlots })
  }
  return out
}

export interface BookingPageConfig {
  tz: string
  windowDays: number
  slotLengthMins: number
  slotIntervalMins: number
  minNoticeHours: number
  // When set, the page defines its own weekly availability window and slots are
  // built from it directly. When null, the trainer's global AvailabilitySlots
  // are used instead.
  availability?: { days: number[]; startTime: string; endTime: string } | null
}

/**
 * Fetch the trainer's availability/blackouts/sessions and produce the bookable
 * slots for the booking page. `now` is injectable for testing; defaults to the
 * current instant.
 */
export async function fetchBookingSlots(
  trainerId: string,
  cfg: BookingPageConfig,
  now: Date = new Date(),
): Promise<DaySlots[]> {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
    .formatToParts(now)
    .reduce((acc, p) => (p.type === 'literal' ? acc : { ...acc, [p.type]: p.value }), {} as Record<string, string>)
  const today = `${todayStr.year}-${todayStr.month}-${todayStr.day}`
  const lastDate = addDayStr(today, Math.max(1, cfg.windowDays))

  // Pad the UTC fetch range by a day each side so tz offsets still pull in the
  // sessions/blackouts that touch our local window.
  const fetchStart = new Date(`${today}T00:00:00Z`)
  fetchStart.setUTCDate(fetchStart.getUTCDate() - 1)
  const fetchEnd = new Date(`${lastDate}T23:59:59Z`)
  fetchEnd.setUTCDate(fetchEnd.getUTCDate() + 1)

  const [rawBlackouts, rawSessions] = await Promise.all([
    prisma.blackoutPeriod.findMany({
      where: { trainerId, endDate: { gte: fetchStart } },
    }),
    prisma.trainingSession.findMany({
      where: { trainerId, scheduledAt: { gte: fetchStart, lte: fetchEnd }, status: 'UPCOMING' },
      select: { scheduledAt: true, durationMins: true },
    }),
  ])

  // Availability source: the page's own weekly window when set, otherwise the
  // trainer's global AvailabilitySlots.
  let slots: AvailabilityRow[]
  if (cfg.availability) {
    const { days, startTime, endTime } = cfg.availability
    slots = days.map(d => ({ id: `avail-${d}`, dayOfWeek: d, date: null, startTime, endTime, cadenceWeeks: 1, firstDate: null }))
  } else {
    const rawSlots = await prisma.availabilitySlot.findMany({
      where: { trainerId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    })
    slots = rawSlots.map(s => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      date: s.date ? s.date.toISOString().split('T')[0] : null,
      startTime: s.startTime,
      endTime: s.endTime,
      cadenceWeeks: s.cadenceWeeks,
      firstDate: s.firstDate ? s.firstDate.toISOString().split('T')[0] : null,
    }))
  }

  const blackouts: BlackoutRow[] = rawBlackouts.map(b => ({
    startDate: b.startDate.toISOString().split('T')[0],
    endDate: b.endDate.toISOString().split('T')[0],
  }))

  // Group existing UPCOMING sessions by trainer-local date for collision tests.
  const busyByDate = new Map<string, { start: number; end: number }[]>()
  for (const s of rawSessions) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: cfg.tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(s.scheduledAt)
    const got: Record<string, string> = {}
    for (const p of parts) if (p.type !== 'literal') got[p.type] = p.value
    const dateStr = `${got.year}-${got.month}-${got.day}`
    const start = Number(got.hour) * 60 + Number(got.minute)
    const arr = busyByDate.get(dateStr) ?? []
    arr.push({ start, end: start + s.durationMins })
    busyByDate.set(dateStr, arr)
  }

  return generateBookingSlots({
    tz: cfg.tz,
    todayStr: today,
    windowDays: cfg.windowDays,
    slotLengthMins: cfg.slotLengthMins,
    slotIntervalMins: cfg.slotIntervalMins,
    minNoticeHours: cfg.minNoticeHours,
    slots,
    blackouts,
    busyByDate,
    now,
  })
}

/** True if `iso` is currently a real bookable slot for this trainer/config. */
export async function isSlotAvailable(
  trainerId: string,
  cfg: BookingPageConfig,
  iso: string,
  now: Date = new Date(),
): Promise<boolean> {
  const days = await fetchBookingSlots(trainerId, cfg, now)
  return days.some(d => d.slots.some(s => s.iso === iso))
}
