import { redirect } from 'next/navigation'
import { getActiveClient } from '@/lib/client-context'
import { todayInTz } from '@/lib/timezone'
import { slotAppliesOnDate, isBlackoutDate } from '@/lib/availability'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { Clock } from 'lucide-react'
import { SelfBookCta } from './self-book-cta'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Availability' }

const DAYS_AHEAD = 28

interface FreeRange { startMin: number; endMin: number }

interface DayAvailability {
  dateStr: string
  blackedOut: boolean
  ranges: FreeRange[]
  totalFreeMin: number
  totalSlotMin: number
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

// Date labels are derived deterministically from the trainer-local calendar
// date (dateStr) — never via toLocaleDateString with a timeZone, which can tip
// a noon-UTC instant onto the wrong day for far-offset zones (e.g. NZ), making
// this page disagree with the self-book picker.
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

function subtractRanges(slotStart: number, slotEnd: number, booked: { start: number; end: number }[]): FreeRange[] {
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
  const free: FreeRange[] = []
  let cursor = slotStart
  for (const b of merged) {
    if (b.start > cursor) free.push({ startMin: cursor, endMin: b.start })
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < slotEnd) free.push({ startMin: cursor, endMin: slotEnd })
  return free
}

export default async function MyAvailabilityPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const avail = await getTrainerAvailabilityForClient(active.clientId)
  if (!avail) redirect('/login')
  const { businessName, tz, slots, blackouts, busy } = avail

  const today = todayInTz(tz)
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDayStr(today, i))

  // Group existing UPCOMING bookings (already trainer-local minute ranges) by day.
  const sessionsByDate = new Map<string, { start: number; end: number }[]>()
  for (const b of busy) {
    const arr = sessionsByDate.get(b.dateStr) ?? []
    arr.push({ start: b.startMin, end: b.endMin })
    sessionsByDate.set(b.dateStr, arr)
  }

  const days: DayAvailability[] = dates.map(dateStr => {
    if (isBlackoutDate(blackouts, dateStr)) {
      return { dateStr, blackedOut: true, ranges: [], totalFreeMin: 0, totalSlotMin: 0 }
    }
    const isoDow = dayOfWeekIso(dateStr)
    const applicable = slots.filter(s => slotAppliesOnDate(s, dateStr, isoDow))
    const booked = sessionsByDate.get(dateStr) ?? []
    const ranges: FreeRange[] = []
    let totalSlotMin = 0
    let totalFreeMin = 0
    for (const slot of applicable) {
      const slotStart = parseHM(slot.startTime)
      const slotEnd = parseHM(slot.endTime)
      totalSlotMin += slotEnd - slotStart
      const free = subtractRanges(slotStart, slotEnd, booked)
      for (const f of free) {
        totalFreeMin += f.endMin - f.startMin
        ranges.push(f)
      }
    }
    return { dateStr, blackedOut: false, ranges, totalFreeMin, totalSlotMin }
  })

  // Group days into Mon-anchored weeks for nicer scanning.
  const weeks: { weekStart: string; days: DayAvailability[] }[] = []
  for (const day of days) {
    const dow = dayOfWeekIso(day.dateStr)
    const weekStart = addDayStr(day.dateStr, -(dow - 1))
    const last = weeks[weeks.length - 1]
    if (!last || last.weekStart !== weekStart) weeks.push({ weekStart, days: [day] })
    else last.days.push(day)
  }

  const hasAnyOpenTime = weeks.some(w => w.days.some(d => d.ranges.length > 0))

  return (
    <div className="px-5 lg:px-8 pt-6 pb-10 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900">Availability</h1>
      <p className="text-sm text-slate-500 mt-1">
        Open times from <span className="font-medium text-slate-700">{businessName}</span> over the next four weeks.
      </p>

      <SelfBookCta />

      {!hasAnyOpenTime ? (
        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Clock className="h-7 w-7 text-slate-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-600">No open slots right now</p>
          <p className="mt-1 text-xs text-slate-400 max-w-xs">
            Your trainer hasn&apos;t published any availability for the next four weeks. Check back later or message them directly.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {weeks.map(week => {
            const weekHasContent = week.days.some(d => d.ranges.length > 0 || d.blackedOut || d.totalSlotMin > 0)
            if (!weekHasContent) return null
            return (
              <section key={week.weekStart}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Week of {formatWeekLabel(week.weekStart)}
                </h2>
                <div className="mt-3 space-y-2">
                  {week.days.map(day => (
                    <DayRow key={day.dateStr} day={day} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatWeekLabel(dateStr: string): string {
  return dayMonthShort(dateStr)
}

function DayRow({ day }: { day: DayAvailability }) {
  const weekday = weekdayShort(day.dateStr)
  const dayLabel = dayMonthShort(day.dateStr)

  if (day.blackedOut) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
        <div className="w-20 shrink-0">
          <p className="text-sm font-semibold text-slate-500">{weekday}</p>
          <p className="text-xs text-slate-400">{dayLabel}</p>
        </div>
        <p className="text-xs text-slate-400 italic">Unavailable</p>
      </div>
    )
  }

  if (day.totalSlotMin === 0) return null

  const fullyBooked = day.totalFreeMin === 0

  return (
    <div className="flex items-start gap-3 rounded-xl bg-white border border-slate-100 px-4 py-3">
      <div className="w-20 shrink-0">
        <p className="text-sm font-semibold text-slate-900">{weekday}</p>
        <p className="text-xs text-slate-400">{dayLabel}</p>
      </div>
      <div className="flex-1 min-w-0">
        {fullyBooked ? (
          <p className="text-xs text-slate-400 italic">Fully booked</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {day.ranges.map((r, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-medium"
              >
                <Clock className="h-3 w-3" />
                {fmt12(r.startMin)} – {fmt12(r.endMin)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
