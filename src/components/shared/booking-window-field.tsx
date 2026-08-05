'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Clock, Plus, Sparkles, Trash2, AlertTriangle } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'
import {
  ANY_TIME_WINDOW, validateBookingWindow, isoDayName,
  type PackageBookingMode, type PackageBookingWindow, type ExactBookingTime,
} from '@/lib/package-booking-window'

/**
 * WHEN clients may self-book a 1:1 offering.
 *
 * Lives in the offering form's Settings step, beside "Require payment to book"
 * and "Let clients self-book" — all three decide HOW someone books rather than
 * what the offering is, and a trainer setting one is usually about to set the
 * others.
 *
 * Mobile-first: one bordered block, hairline dividers, full-width rows at
 * 390px. No tinted icon tiles, no floating cards.
 */

const MODES: { key: PackageBookingMode; icon: typeof Clock; label: string; desc: string }[] = [
  {
    key: 'ANY_TIME',
    icon: Sparkles,
    label: 'Any time I’m free',
    desc: 'Clients pick from your normal availability. This is how it works today.',
  },
  {
    key: 'WEEKLY_WINDOW',
    icon: CalendarClock,
    label: 'Only on certain days and hours',
    desc: 'Pick the days and the window — “Tuesdays and Thursdays, 9am to 1pm”.',
  },
  {
    key: 'EXACT_TIMES',
    icon: Clock,
    label: 'Only at times I name',
    desc: 'List the exact starts — “Tue 9:00, Tue 10:30, Thu 2:00pm”.',
  },
]

const DAYS = [1, 2, 3, 4, 5, 6, 7]

export function BookingWindowField({
  value,
  onChange,
  durationMins,
  bufferMins,
}: {
  value: PackageBookingWindow
  onChange: (next: PackageBookingWindow) => void
  /** Needed by the preview — a 90-minute session fits fewer windows than a 30. */
  durationMins: number
  bufferMins: number
}) {
  const problem = validateBookingWindow(value)

  function setMode(mode: PackageBookingMode) {
    if (mode === value.mode) return
    if (mode === 'ANY_TIME') return onChange({ ...ANY_TIME_WINDOW })
    if (mode === 'WEEKLY_WINDOW') {
      // Open on something usable rather than an empty form that immediately
      // complains at them.
      onChange({
        mode,
        days: value.days.length ? value.days : [1, 2, 3, 4, 5],
        startTime: value.startTime ?? '09:00',
        endTime: value.endTime ?? '17:00',
        times: [],
      })
      return
    }
    onChange({
      mode,
      days: [],
      startTime: null,
      endTime: null,
      times: value.times.length ? value.times : [{ day: 2, time: '09:00' }],
    })
  }

  function toggleDay(d: number) {
    const on = value.days.includes(d)
    onChange({ ...value, days: (on ? value.days.filter(x => x !== d) : [...value.days, d]).sort((a, b) => a - b) })
  }

  function setTime(i: number, patch: Partial<ExactBookingTime>) {
    onChange({ ...value, times: value.times.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  }

  return (
    <div className="md:col-span-2">
      <label className="text-sm font-medium text-slate-700 block mb-1.5">When clients can book this</label>
      <p className="text-[11px] text-slate-400 mb-2">
        Your availability, your days off and anything already in your diary always
        apply on top of this — a window here only ever narrows what’s on offer, it
        never opens up an hour you aren’t free.
      </p>

      <FlatBlock>
        {MODES.map(m => {
          const on = value.mode === m.key
          const Icon = m.icon
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              aria-pressed={on}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left active:bg-slate-50"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                  on ? 'border-blue-600' : 'border-slate-300'
                }`}
              >
                {on && <span className="h-2 w-2 rounded-full bg-blue-600" />}
              </span>
              <Icon className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${on ? 'text-slate-900' : 'text-slate-700'}`}>{m.label}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{m.desc}</span>
              </span>
            </button>
          )
        })}
      </FlatBlock>

      {value.mode === 'WEEKLY_WINDOW' && (
        <div className="mt-2.5 rounded-xl border border-slate-200 px-3 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1.5">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(d => {
              const on = value.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  aria-pressed={on}
                  className={`h-9 min-w-[3rem] rounded-lg border px-2 text-sm ${
                    on ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {isoDayName(d)}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="bookWindowStart" className="text-[11px] text-slate-500 block mb-1">From</label>
              <input
                id="bookWindowStart"
                type="time"
                value={value.startTime ?? ''}
                onChange={e => onChange({ ...value, startTime: e.target.value || null })}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label htmlFor="bookWindowEnd" className="text-[11px] text-slate-500 block mb-1">To</label>
              <input
                id="bookWindowEnd"
                type="time"
                value={value.endTime ?? ''}
                onChange={e => onChange({ ...value, endTime: e.target.value || null })}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
        </div>
      )}

      {value.mode === 'EXACT_TIMES' && (
        <div className="mt-2.5 rounded-xl border border-slate-200 px-3 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1.5">Start times</p>
          <div className="flex flex-col gap-2">
            {value.times.map((t, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`bookWindowDay-${i}`} className="text-[11px] text-slate-500 block mb-1">Day</label>
                  <select
                    id={`bookWindowDay-${i}`}
                    value={t.day}
                    onChange={e => setTime(i, { day: Number(e.target.value) })}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {DAYS.map(d => <option key={d} value={d}>{isoDayName(d)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`bookWindowTime-${i}`} className="text-[11px] text-slate-500 block mb-1">Starts</label>
                  <input
                    id={`bookWindowTime-${i}`}
                    type="time"
                    value={t.time}
                    onChange={e => setTime(i, { time: e.target.value })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, times: value.times.filter((_, j) => j !== i) })}
                  aria-label={`Remove ${isoDayName(t.day)} ${t.time}`}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 active:bg-slate-50"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...value, times: [...value.times, { day: 2, time: '09:00' }] })}
            className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 active:bg-slate-50"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a start time
          </button>
        </div>
      )}

      {problem && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-rose-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
          {problem}
        </p>
      )}

      {!problem && (
        <BookingWindowPreview window={value} durationMins={durationMins} bufferMins={bufferMins} />
      )}
    </div>
  )
}

/**
 * "This window offers nothing" — said HERE, to the trainer, while they can fix
 * it.
 *
 * A window narrows, so Sunday mornings on a trainer who doesn't work Sundays
 * produces a booking screen with no times on it and no explanation. Without
 * this the first person to find out is a client. The count comes from the API,
 * which runs the same resolver the client's picker does against real
 * availability, real days off and what's really in the diary.
 */
function BookingWindowPreview({
  window,
  durationMins,
  bufferMins,
}: {
  window: PackageBookingWindow
  durationMins: number
  bufferMins: number
}) {
  const [state, setState] = useState<{ slotCount: number; daysWithSlots: number; windowDays: number } | null>(null)
  const [loading, setLoading] = useState(false)

  // Serialised so the effect re-runs when the window CONTENT changes, not on
  // every re-render (the object identity changes whenever the form does).
  const key = JSON.stringify(window) + `|${durationMins}|${bufferMins}`

  useEffect(() => {
    if (window.mode === 'ANY_TIME') { setState(null); return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      fetch('/api/packages/booking-window/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ window, durationMins, bufferMins }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (!cancelled) setState(d) })
        .catch(() => { if (!cancelled) setState(null) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (window.mode === 'ANY_TIME' || loading || !state) return null

  if (state.slotCount === 0) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" strokeWidth={1.75} />
        <p className="text-[12px] text-amber-800">
          <span className="font-medium">Nothing is bookable in this window.</span> Over the next{' '}
          {state.windowDays} days it offers no times at all, so clients would see an empty
          booking screen. Check it lines up with your availability in Settings, and that
          the days aren’t all blacked out or already full.
        </p>
      </div>
    )
  }

  return (
    <p className="mt-2 text-[12px] text-slate-500">
      {state.slotCount} bookable time{state.slotCount === 1 ? '' : 's'} across{' '}
      {state.daysWithSlots} day{state.daysWithSlots === 1 ? '' : 's'} in the next {state.windowDays} days.
    </p>
  )
}
