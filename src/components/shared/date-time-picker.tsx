'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react'

// Date + time picker matching the FM-Events design: a date field with a calendar
// popover (month grid, today highlighted) beside a time field with a scrollable
// list. Emits a single Date (or null). One combined value; the two fields just
// edit different parts of it.

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
function fmtTime(d: Date) {
  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function DateTimePicker({
  value,
  onChange,
}: {
  value: Date | null
  onChange: (d: Date | null) => void
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close popovers on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDateOpen(false); setTimeOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pickDay(day: Date) {
    // Keep the existing time-of-day (default 9:00am when none set yet).
    const base = value ?? new Date(new Date().setHours(9, 0, 0, 0))
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes(), 0, 0)
    onChange(next)
    setDateOpen(false)
  }
  function pickTime(mins: number) {
    const base = value ?? new Date(new Date().setHours(9, 0, 0, 0))
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(mins / 60), mins % 60, 0, 0)
    onChange(next)
    setTimeOpen(false)
  }

  const fieldCls = 'h-11 flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div ref={wrapRef} className="flex items-stretch gap-2">
      {/* Date */}
      <div className="relative flex-1 min-w-0">
        <button type="button" onClick={() => { setDateOpen(o => !o); setTimeOpen(false) }} className={fieldCls}>
          <span className={value ? 'text-slate-900 flex-1' : 'text-slate-400 flex-1'}>{value ? fmtDate(value) : 'Pick a date'}</span>
          <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
        </button>
        {dateOpen && <MonthGrid selected={value} onPick={pickDay} />}
      </div>

      {/* Time */}
      <div className="relative flex-1 min-w-0">
        <button type="button" onClick={() => { setTimeOpen(o => !o); setDateOpen(false) }} className={fieldCls}>
          <span className={value ? 'text-slate-900 flex-1' : 'text-slate-400 flex-1'}>{value ? fmtTime(value) : 'Pick a time'}</span>
          <Clock className="h-4 w-4 text-slate-400 shrink-0" />
        </button>
        {timeOpen && <TimeList selected={value} onPick={pickTime} />}
      </div>
    </div>
  )
}

function MonthGrid({ selected, onPick }: { selected: Date | null; onPick: (d: Date) => void }) {
  const today = new Date()
  const [view, setView] = useState(() => {
    const base = selected ?? today
    return { year: base.getFullYear(), month: base.getMonth() }
  })

  const first = new Date(view.year, view.month, 1)
  const startPad = first.getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.year, view.month, d))

  function shift(by: number) {
    const m = view.month + by
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 })
  }

  return (
    <div className="absolute z-50 mt-1 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg shadow-slate-900/10">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => shift(-1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold text-slate-800">{MONTHS[view.month]} {view.year}</span>
        <button type="button" onClick={() => shift(1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_LABELS.map(d => <span key={d} className="text-center text-[11px] font-medium text-slate-400 py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const isToday = sameDay(d, today)
          const isSel = selected && sameDay(d, selected)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(d)}
              className={`h-9 rounded-full text-sm transition-colors ${
                isSel ? 'bg-blue-600 text-white font-semibold'
                  : isToday ? 'text-blue-600 font-semibold hover:bg-blue-50'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimeList({ selected, onPick }: { selected: Date | null; onPick: (mins: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const selMins = selected ? selected.getHours() * 60 + selected.getMinutes() : null
  // 15-minute increments, all day.
  const times: number[] = []
  for (let m = 0; m < 24 * 60; m += 15) times.push(m)

  // Scroll the selected (or 9am) time into view on open.
  useEffect(() => {
    const target = selMins ?? 9 * 60
    const nearest = Math.round(target / 15) * 15
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mins="${nearest}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [selMins])

  function label(mins: number) {
    let h = Math.floor(mins / 60)
    const m = mins % 60
    const ap = h >= 12 ? 'pm' : 'am'
    h = h % 12 || 12
    return `${h}:${String(m).padStart(2, '0')} ${ap}`
  }

  return (
    <div ref={listRef} className="absolute z-50 mt-1 max-h-64 w-40 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10">
      {times.map(m => {
        const isSel = selMins != null && Math.round(selMins / 15) * 15 === m
        return (
          <button
            key={m}
            type="button"
            data-mins={m}
            onClick={() => onPick(m)}
            className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
              isSel ? 'bg-blue-600 text-white font-semibold' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {label(m)}
          </button>
        )
      })}
    </div>
  )
}
