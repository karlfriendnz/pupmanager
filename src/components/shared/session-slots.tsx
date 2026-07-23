'use client'

import { Plus, X, ArrowRight } from 'lucide-react'
import { RecurrenceField } from '@/components/shared/recurrence-field'

// Session slots for a drop-in class, as a card per slot (not a cramped table):
// each slot is a day + start/end time + its own location + a recurrence. Lets a
// class run Tuesdays 3–5pm at one park and every 2nd Saturday somewhere else.

export type SessionSlot = {
  id: string
  day: number // 0 = Sunday … 6 = Saturday
  start: string // "HH:mm" (24h)
  end: string
  capacity: string // '' = unlimited
  locationId: string // '' = none / inherit the class location
  repeat: string // iCalendar RRULE subset (see lib/recurrence.ts); '' = one-off
}

const DAYS = [
  { v: 1, label: 'Monday' }, { v: 2, label: 'Tuesday' }, { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' }, { v: 5, label: 'Friday' }, { v: 6, label: 'Saturday' }, { v: 0, label: 'Sunday' },
]

export function newSlot(): SessionSlot {
  return { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, day: 2, start: '15:00', end: '17:00', capacity: '', locationId: '', repeat: 'FREQ=WEEKLY' }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
      <span className="w-20 shrink-0 text-sm font-medium text-slate-500">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function SessionSlotsEditor({
  value,
  onChange,
  locations,
}: {
  value: SessionSlot[]
  onChange: (slots: SessionSlot[]) => void
  locations: { id: string; name: string }[]
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

          <Row label="Time">
            <div className="flex flex-wrap items-center gap-2">
              <input type="time" value={s.start} onChange={e => update(s.id, { start: e.target.value })} className={ctrl + ' max-w-[140px]'} />
              <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
              <input type="time" value={s.end} onChange={e => update(s.id, { end: e.target.value })} className={ctrl + ' max-w-[140px]'} />
              <span className="ml-1 text-sm font-medium text-slate-500">Capacity</span>
              <input
                type="number" min={1} value={s.capacity}
                onChange={e => update(s.id, { capacity: e.target.value })}
                placeholder="∞"
                className={ctrl + ' max-w-[90px] text-center'}
              />
            </div>
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
