'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react'

// Date + time picker, ported from the FM-Events design: a date field with a
// calendar popover beside a time field that's a two-column wheel (hours |
// minutes) + AM/PM, with type-to-enter and Cancel/Ok. Emits a single Date.

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function DateTimePicker({
  value,
  onChange,
  stacked = false,
}: {
  value: Date | null
  onChange: (d: Date | null) => void
  /** Stack the date (full width) over a labelled time field. */
  stacked?: boolean
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pickDay(day: Date) {
    const base = value ?? new Date(new Date().setHours(9, 0, 0, 0))
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes(), 0, 0))
    setDateOpen(false)
  }

  const fieldCls = 'h-11 flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-left hover:border-slate-300 focus-within:ring-2 focus-within:ring-blue-500'

  if (stacked) {
    // Date + Time side by side across the full row, each labelled.
    return (
      <div ref={wrapRef} className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium text-slate-500 block mb-1">Date</label>
          <div className="relative">
            <button type="button" onClick={() => setDateOpen(o => !o)} className={fieldCls + ' w-full focus:outline-none'}>
              <span className={value ? 'text-slate-900 flex-1' : 'text-slate-400 flex-1'}>{value ? fmtDate(value) : 'Pick a date'}</span>
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
            {dateOpen && <MonthGrid selected={value} onPick={pickDay} />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium text-slate-500 block mb-1">Time</label>
          <TimeWheel value={value} onChange={onChange} fieldCls={fieldCls} />
        </div>
      </div>
    )
  }

  // Two equal columns. The date button needs an explicit w-full: a <button> is
  // sized to fit its content even as a flex container, so fieldCls's flex-1
  // does nothing here (its parent is the relative div, not a flex box) and the
  // field collapsed to the width of "Pick a date" inside a half-width column.
  // items-end keeps the two fields on one baseline despite the Time label.
  return (
    <div ref={wrapRef} className="flex items-end gap-2">
      {/* Date */}
      <div className="relative flex-1 min-w-0">
        <button type="button" onClick={() => setDateOpen(o => !o)} className={fieldCls + ' w-full focus:outline-none'}>
          <span className={value ? 'text-slate-900 flex-1' : 'text-slate-400 flex-1'}>{value ? fmtDate(value) : 'Pick a date'}</span>
          <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
        </button>
        {dateOpen && <MonthGrid selected={value} onPick={pickDay} />}
      </div>

      {/* Time — labelled, since the field's own "--:--" placeholder is the only
          other clue as to what it wants. */}
      <div className="flex-1 min-w-0">
        <label className="text-sm font-medium text-slate-500 block mb-1">Time</label>
        <TimeWheel value={value} onChange={onChange} fieldCls={fieldCls} />
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

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = Array.from({ length: 60 }, (_, m) => m)

function display(d: Date | null): string {
  if (!d) return ''
  const h24 = d.getHours()
  const mer = h24 >= 12 ? 'pm' : 'am'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${mer}`
}

// Parse "9:30", "930", "9:30pm", "21:15" into a Date carrying the given day.
function parseTyped(raw: string, base: Date | null): Date | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const m = s.match(/^(\d{1,2})[:. ]?(\d{2})?\s*(a\.?m\.?|p\.?m\.?|a|p)?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  if (min > 59) return null
  const ap = m[3]?.[0]
  if (ap === 'p' && h < 12) h += 12
  if (ap === 'a' && h === 12) h = 0
  if (h > 23) return null
  const d = base ? new Date(base) : new Date()
  d.setHours(h, min, 0, 0)
  return d
}

function TimeWheel({ value, onChange, fieldCls }: { value: Date | null; onChange: (d: Date | null) => void; fieldCls: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(display(value))
  // Draft selection — applied only on Ok.
  const [selHour, setSelHour] = useState(12)
  const [selMin, setSelMin] = useState(0)
  const [mer, setMer] = useState<'AM' | 'PM'>('AM')
  const wrapRef = useRef<HTMLDivElement>(null)
  const hourCol = useRef<HTMLDivElement>(null)
  const minCol = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(display(value)) }, [value])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function seed() {
    const h24 = value ? value.getHours() : 9
    setMer(h24 >= 12 ? 'PM' : 'AM')
    setSelHour(h24 % 12 === 0 ? 12 : h24 % 12)
    setSelMin(value ? value.getMinutes() : 0)
  }
  function openPanel() { seed(); setOpen(true) }

  // Centre the selected row in each column when open (and when it changes).
  function centre(col: HTMLDivElement | null, idx: number, smooth: boolean) {
    if (!col) return
    const item = col.children[idx] as HTMLElement | undefined
    if (item) col.scrollTo({ top: item.offsetTop - col.clientHeight / 2 + item.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => {
    if (!open) return
    centre(hourCol.current, HOURS.indexOf(selHour), false)
    centre(minCol.current, selMin, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => { if (open) centre(hourCol.current, HOURS.indexOf(selHour), true) }, [selHour, open])
  useEffect(() => { if (open) centre(minCol.current, selMin, true) }, [selMin, open])

  function commitText() {
    if (!text.trim()) { if (value) onChange(null); return }
    const d = parseTyped(text, value)
    if (d) onChange(d)
    else setText(display(value))
  }
  function ok() {
    const base = value ? new Date(value) : new Date()
    const h24 = (selHour % 12) + (mer === 'PM' ? 12 : 0)
    base.setHours(h24, selMin, 0, 0)
    onChange(base)
    setOpen(false)
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <div className={fieldCls} onClick={() => !open && openPanel()}>
        <input
          type="text"
          value={text}
          placeholder="--:--"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitText() } }}
          onBlur={commitText}
          className="flex-1 min-w-0 border-none bg-transparent p-0 text-sm text-slate-900 tabular-nums outline-none placeholder:text-slate-400"
        />
        <button type="button" tabIndex={-1} onClick={e => { e.stopPropagation(); open ? setOpen(false) : openPanel() }} className="text-slate-400 hover:text-blue-600">
          <Clock className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-[236px] rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-stretch pt-0.5">
            <div ref={hourCol} className="flex-1 flex flex-col gap-0.5 h-[168px] overflow-y-auto py-[68px] px-1.5 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
              {HOURS.map(h => (
                <button key={h} type="button" onClick={() => setSelHour(h)}
                  className={`shrink-0 h-[30px] flex items-center justify-center rounded-lg text-[15px] tabular-nums transition-colors ${selHour === h ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-slate-800 hover:bg-slate-100'}`}>
                  {pad(h)}
                </button>
              ))}
            </div>
            <div className="flex items-center font-bold text-slate-300">:</div>
            <div ref={minCol} className="flex-1 flex flex-col gap-0.5 h-[168px] overflow-y-auto py-[68px] px-1.5 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
              {MINUTES.map(m => (
                <button key={m} type="button" onClick={() => setSelMin(m)}
                  className={`shrink-0 h-[30px] flex items-center justify-center rounded-lg text-[15px] tabular-nums transition-colors ${selMin === m ? 'bg-blue-600 text-white font-bold shadow-sm' : 'text-slate-800 hover:bg-slate-100'}`}>
                  {pad(m)}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-0.5 pt-[68px] pb-[68px] pr-1 pl-2">
              {(['AM', 'PM'] as const).map(a => (
                <button key={a} type="button" onClick={() => setMer(a)}
                  className={`h-[30px] px-3 flex items-center justify-center rounded-lg text-[13px] font-semibold transition-colors ${mer === a ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-4 items-center px-3 py-2 border-t border-slate-100">
            <button type="button" onClick={() => setOpen(false)} className="text-[13px] font-medium text-slate-400 hover:text-slate-600">Cancel</button>
            <button type="button" onClick={ok} className="text-[13px] font-bold text-slate-500 hover:text-blue-600">Ok</button>
          </div>
        </div>
      )}
    </div>
  )
}
