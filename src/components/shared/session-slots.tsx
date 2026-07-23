'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, X, ArrowRight, Info, ChevronDown, Check } from 'lucide-react'
import { RecurrenceField } from '@/components/shared/recurrence-field'
import { bufferOptions } from '@/components/shared/buffer-field'
import { normalizeBufferMins } from '@/lib/buffer'

// Session slots for a drop-in class, as a card per slot (not a cramped table).
// Each card is a WHOLE session: its own start date, time, duration, gap,
// capacity, location and recurrence. Lets a class run Tuesdays 3–5pm at one
// park and every 2nd Saturday somewhere else.

export type SessionSlot = {
  id: string
  startDate: string // "YYYY-MM-DD" — first occurrence
  day: number // 0 = Sunday … 6 = Saturday
  start: string // "HH:mm" (24h)
  end: string
  gap: string // mins between this and the next session
  capacity: string // '' = unlimited
  price: string // dollars as typed; '' = free — each session prices itself
  assignedIds: string[] // team members running this session
  locationId: string // '' = none / inherit the class location
  repeat: string // iCalendar RRULE subset (see lib/recurrence.ts); '' = one-off
}

const DAYS = [
  { v: 1, label: 'Monday' }, { v: 2, label: 'Tuesday' }, { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' }, { v: 5, label: 'Friday' }, { v: 6, label: 'Saturday' }, { v: 0, label: 'Sunday' },
]

const GAP_HELP = 'Time you need after each session — travel, clean-up, a breather. Nothing can be booked into it.'

export function newSlot(): SessionSlot {
  return { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, startDate: '', day: 1, start: '15:00', end: '17:00', gap: '0', capacity: '', price: '', assignedIds: [], locationId: '', repeat: 'FREQ=WEEKLY' }
}

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    // items-start + a control-height label box, so a label always lines up with
    // the FIRST line of its control (e.g. Repeat's select, not its summary).
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
      <span className="w-24 shrink-0 text-sm font-medium text-slate-500 flex items-center gap-1.5 sm:min-h-[2.75rem]">
        {label}
        {help && (
          <span className="group relative inline-flex">
            <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" aria-label={help} />
            <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 hidden -translate-x-1/2 w-56 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block">{help}</span>
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function SessionSlotsEditor({
  value,
  onChange,
  locations,
  team = [],
}: {
  value: SessionSlot[]
  onChange: (slots: SessionSlot[]) => void
  locations: { id: string; name: string }[]
  team?: { id: string; name: string | null; title: string | null }[]
}) {
  function update(id: string, patch: Partial<SessionSlot>) {
    onChange(value.map(s => (s.id === id ? { ...s, ...patch } : s)))
  }
  const ctrl = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="md:col-span-2 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sessions</span>
        <span className="text-xs font-semibold text-slate-500">{value.length} {value.length === 1 ? 'time' : 'times'}</span>
      </div>

      {value.map(s => (
        <div key={s.id} className="relative rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3 shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
          <button
            type="button"
            onClick={() => onChange(value.filter(x => x.id !== s.id))}
            className="absolute top-3 right-3 text-slate-300 hover:text-red-500"
            aria-label="Remove this session"
          >
            <X className="h-5 w-5" />
          </button>

          <Row label="Day">
            <select value={s.day} onChange={e => update(s.id, { day: Number(e.target.value) })} className={ctrl + ' max-w-[220px]'}>
              {DAYS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </Row>

          <Row label="Starts from">
            <input type="date" value={s.startDate} onChange={e => update(s.id, { startDate: e.target.value })} className={ctrl + ' max-w-[200px]'} />
          </Row>

          <Row label="Time">
            <div className="flex items-center gap-2">
              <input type="time" value={s.start} onChange={e => update(s.id, { start: e.target.value })} className={ctrl + ' max-w-[140px]'} />
              <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
              <input type="time" value={s.end} onChange={e => update(s.id, { end: e.target.value })} className={ctrl + ' max-w-[140px]'} />
            </div>
          </Row>

          <Row label="Capacity">
            <input type="number" min={1} value={s.capacity} onChange={e => update(s.id, { capacity: e.target.value })} placeholder="∞ Unlimited" className={ctrl + ' max-w-[160px]'} />
          </Row>

          <Row label="Price">
            <div className="relative max-w-[160px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input value={s.price} onChange={e => update(s.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00" className={ctrl + ' pl-6'} />
            </div>
          </Row>

          <Row label="Gap" help={GAP_HELP}>
            <select value={String(normalizeBufferMins(Number(s.gap) || 0))} onChange={e => update(s.id, { gap: e.target.value })} className={ctrl + ' max-w-[220px]'}>
              {bufferOptions(normalizeBufferMins(Number(s.gap) || 0)).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Row>

          <Row label="Repeat">
            <RecurrenceField value={s.repeat} onChange={r => update(s.id, { repeat: r })} />
          </Row>

          <Row label="Location">
            <select value={s.locationId} onChange={e => update(s.id, { locationId: e.target.value })} className={ctrl}>
              <option value="">Class location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Row>

          {team.length > 0 && (
            <Row label="Assigned to">
              <AssignSelect team={team} value={s.assignedIds} onChange={ids => update(s.id, { assignedIds: ids })} />
            </Row>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, newSlot()])}
        className="self-end inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-600 shadow-sm"
      >
        <Plus className="h-4 w-4" /> Add session
      </button>
    </div>
  )
}

// Compact multi-select of team members, for a session's "Assigned to".
function AssignSelect({
  team,
  value,
  onChange,
}: {
  team: { id: string; name: string | null; title: string | null }[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const label = value.length === 0
    ? 'Anyone / unassigned'
    : value.length === 1
      ? (team.find(m => m.id === value[0])?.name ?? 'Team member')
      : `${value.length} team members`
  return (
    <div ref={ref} className="relative max-w-[280px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="h-11 w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className={`flex-1 truncate ${value.length ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10">
          {team.map(m => {
            const on = value.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(on ? value.filter(x => x !== m.id) : [...value, m.id])}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="text-slate-800">{m.name ?? 'Team member'}{m.title ? <span className="text-slate-400"> · {m.title}</span> : null}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
