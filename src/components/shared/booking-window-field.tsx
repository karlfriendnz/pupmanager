'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Clock, Plus, Sparkles, Trash2, AlertTriangle } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'
import {
  ANY_TIME_WINDOW, validateBookingWindow, isoDayName, isExpiredDate, localDateStr,
  type PackageBookingMode, type PackageBookingWindow, type BookingRange, type DatedBookingTime,
} from '@/lib/package-booking-window'

/**
 * WHEN a 1:1 offering can be booked.
 *
 * Lives in the offering form's Settings step, beside "Require payment to book"
 * and "Let clients self-book" — all three decide HOW someone books rather than
 * what the offering is.
 *
 * Shown whether or not self-booking is on: this says when the offering RUNS,
 * and the trainer's own assign screens read it too.
 *
 * ─── One list, not two ──────────────────────────────────────────────────────
 * "Days and hours" and "exact start times" were two blocks with two Add buttons
 * and that read as two features. They are one question — when does this run —
 * so there is ONE list of rows, and the row's first dropdown says what kind of
 * row it is:
 *
 *   Mon … Sun            → repeats weekly; the row shows From / To.
 *   Exact date and time  → happens once; the row shows a date and one start.
 *
 * The two stay distinct in the DATA (weekly bands and dated one-offs resolve
 * differently). Only the editing surface merges.
 */

const MODES: { key: PackageBookingMode; icon: typeof Clock; label: string; desc: string }[] = [
  {
    key: 'ANY_TIME',
    icon: Sparkles,
    label: 'Any time I’m free',
    desc: 'Book it anywhere in your normal availability. This is how it works today.',
  },
  {
    key: 'RESTRICTED',
    icon: CalendarClock,
    label: 'Only at set days and times',
    desc: 'Say when this one runs — “Mon 3–5pm”, “Wed 1–7pm”, or a one-off on a date.',
  },
]

const DAYS = [1, 2, 3, 4, 5, 6, 7]
/** The row-kind dropdown's value for a one-off. Not a weekday, so it can never
 *  collide with 1–7. */
const EXACT = 'exact'

const SELECT = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
const FIELD = 'h-10 w-full rounded-xl border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

/**
 * The two arrays flattened into ONE ordered list for editing, then split back
 * on every change. Weekly rows first, then dated ones — the same order the
 * summary line reads in, so what the trainer sees here matches what the assign
 * screens tell them later.
 */
type Row =
  | { kind: 'weekly'; value: BookingRange }
  | { kind: 'exact'; value: DatedBookingTime }

function toRows(window: PackageBookingWindow): Row[] {
  return [
    ...window.ranges.map(value => ({ kind: 'weekly' as const, value })),
    ...window.dates.map(value => ({ kind: 'exact' as const, value })),
  ]
}

function fromRows(rows: Row[]): Pick<PackageBookingWindow, 'ranges' | 'dates'> {
  return {
    ranges: rows.filter((r): r is Extract<Row, { kind: 'weekly' }> => r.kind === 'weekly').map(r => r.value),
    dates: rows.filter((r): r is Extract<Row, { kind: 'exact' }> => r.kind === 'exact').map(r => r.value),
  }
}

export function BookingWindowField({
  value,
  onChange,
  durationMins,
  bufferMins,
}: {
  value: PackageBookingWindow
  onChange: (next: PackageBookingWindow) => void
  /** Needed by the preview — a 90-minute session fits fewer bands than a 30. */
  durationMins: number
  bufferMins: number
}) {
  const problem = validateBookingWindow(value)
  const restricted = value.mode === 'RESTRICTED'
  const rows = toRows(value)
  // For the "expired" hint only. A local day is right here: the trainer is
  // looking at their own calendar.
  const today = localDateStr(new Date())

  function setRows(next: Row[]) {
    onChange({ mode: 'RESTRICTED', ...fromRows(next) })
  }

  function setMode(mode: PackageBookingMode) {
    if (mode === value.mode) return
    if (mode === 'ANY_TIME') {
      // Keep nothing. Switching back is a decision, and a hidden window that
      // sprang back to life later would be a surprise.
      onChange({ ...ANY_TIME_WINDOW })
      return
    }
    onChange({
      mode: 'RESTRICTED',
      ranges: rows.length ? value.ranges : [{ day: 1, start: '09:00', end: '17:00' }],
      dates: value.dates,
    })
  }

  /** The first dropdown IS the row-kind switch. Changing it rebuilds the row
   *  in the other shape rather than keeping a half-filled one. */
  function changeKind(i: number, raw: string) {
    const next = [...rows]
    if (raw === EXACT) {
      if (rows[i].kind === 'exact') return
      const t = rows[i].kind === 'weekly' ? (rows[i].value as BookingRange).start : '10:00'
      next[i] = { kind: 'exact', value: { date: today, time: t } }
    } else {
      const day = Number(raw)
      if (rows[i].kind === 'weekly') {
        next[i] = { kind: 'weekly', value: { ...(rows[i].value as BookingRange), day } }
      } else {
        const t = (rows[i].value as DatedBookingTime).time
        next[i] = { kind: 'weekly', value: { day, start: t, end: '17:00' } }
      }
    }
    setRows(next)
  }

  function patchRow(i: number, patch: Record<string, string>) {
    const next = [...rows]
    const row = next[i]
    next[i] = { kind: row.kind, value: { ...row.value, ...patch } } as Row
    setRows(next)
  }

  return (
    <div className="md:col-span-2">
      <label className="text-sm font-medium text-slate-700 block mb-1.5">When this can be booked</label>
      <p className="text-[11px] text-slate-400 mb-2">
        Applies to you and to clients. Your availability, days off and anything
        already in your diary always apply on top — this only ever narrows what’s
        on offer, it never opens up an hour you aren’t free.
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

      {restricted && (
        <div className="mt-2.5 rounded-xl border border-slate-200 px-3 py-3">
          {rows.length === 0 && (
            <p className="text-[11px] text-slate-400 mb-2">Nothing set yet — add a day, or a one-off date.</p>
          )}
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => {
              const expired = row.kind === 'exact' && isExpiredDate(row.value, today)
              return (
                <div key={i} className="flex flex-col gap-1">
                  {/* Wraps at 390px rather than crushing four controls onto one line. */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[8.5rem] flex-1">
                      <label htmlFor={`bwKind-${i}`} className="text-[11px] text-slate-500 block mb-1">When</label>
                      <select
                        id={`bwKind-${i}`}
                        value={row.kind === 'exact' ? EXACT : String(row.value.day)}
                        onChange={e => changeKind(i, e.target.value)}
                        className={SELECT}
                      >
                        {DAYS.map(d => <option key={d} value={d}>{isoDayName(d)}</option>)}
                        <option value={EXACT}>Exact date and time</option>
                      </select>
                    </div>

                    {row.kind === 'weekly' ? (
                      <>
                        <div className="w-[6.5rem]">
                          <label htmlFor={`bwFrom-${i}`} className="text-[11px] text-slate-500 block mb-1">From</label>
                          <input
                            id={`bwFrom-${i}`}
                            type="time"
                            value={row.value.start}
                            onChange={e => patchRow(i, { start: e.target.value })}
                            className={FIELD}
                          />
                        </div>
                        <div className="w-[6.5rem]">
                          <label htmlFor={`bwTo-${i}`} className="text-[11px] text-slate-500 block mb-1">To</label>
                          <input
                            id={`bwTo-${i}`}
                            type="time"
                            value={row.value.end}
                            onChange={e => patchRow(i, { end: e.target.value })}
                            className={FIELD}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {/* A booking date is near-term, so the NATIVE picker is
                            right — the three-dropdown control is for birthdays. */}
                        <div className="w-[9.5rem]">
                          <label htmlFor={`bwDate-${i}`} className="text-[11px] text-slate-500 block mb-1">Date</label>
                          <input
                            id={`bwDate-${i}`}
                            type="date"
                            value={row.value.date}
                            onChange={e => patchRow(i, { date: e.target.value })}
                            className={FIELD}
                          />
                        </div>
                        <div className="w-[6.5rem]">
                          <label htmlFor={`bwAt-${i}`} className="text-[11px] text-slate-500 block mb-1">Starts</label>
                          <input
                            id={`bwAt-${i}`}
                            type="time"
                            value={row.value.time}
                            onChange={e => patchRow(i, { time: e.target.value })}
                            className={FIELD}
                          />
                        </div>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      aria-label="Remove this time"
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 active:bg-slate-50"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  {expired && (
                    <p className="text-[11px] text-slate-400">
                      That date has passed — kept here, but it can’t be booked any more.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => setRows([...rows, { kind: 'weekly', value: { day: 1, start: '09:00', end: '17:00' } }])}
            className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-sm text-slate-600 active:bg-slate-50"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a time
          </button>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Add the same day twice for a morning and an afternoon block.
          </p>
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
 * produces a booking screen with no times on it and no explanation. So does an
 * offering whose only dated entries have all been and gone. Without this the
 * first person to find out is a client. The count comes from the API, which
 * runs the same resolver the client's picker does against real availability,
 * real days off and what's really in the diary — so an expired date counts for
 * nothing there exactly as it counts for nothing at booking time.
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
          booking screen. Check the days line up with your availability in Settings, that
          they aren’t all blacked out or already full, and that any one-off dates are still
          ahead of you.
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
