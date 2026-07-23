'use client'

import { Plus, X } from 'lucide-react'

// Recurring session slots for a drop-in class: each row is one weekly (or
// fortnightly) slot — name, day, start/end time, and its own location. Lets a
// class run, say, Tuesdays 3–5pm at one park and every 2nd Saturday somewhere
// else. Emits an array the schedule is generated from.

export type SessionSlot = {
  id: string
  day: number // 0 = Sunday … 6 = Saturday
  start: string // "HH:mm" (24h)
  end: string
  locationId: string // '' = none / inherit the class location
  repeat: 'WEEKLY' | 'FORTNIGHTLY'
}

const DAYS = [
  { v: 1, label: 'Monday' }, { v: 2, label: 'Tuesday' }, { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' }, { v: 5, label: 'Friday' }, { v: 6, label: 'Saturday' }, { v: 0, label: 'Sunday' },
]

export function newSlot(): SessionSlot {
  return { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, day: 2, start: '15:00', end: '17:00', locationId: '', repeat: 'WEEKLY' }
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
  const cell = 'h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="md:col-span-2 flex flex-col gap-2">
      {/* Column headers — hidden on mobile, where each row stacks with labels. */}
      <div className="hidden lg:grid grid-cols-[1fr_0.9fr_0.9fr_1fr_1.3fr_auto] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Day</span><span>Start</span><span>End</span><span>Repeat</span><span>Location</span><span />
      </div>

      {value.length === 0 && (
        <p className="text-xs text-slate-400 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          No times yet. Add each time this class runs — e.g. Tuesdays 3–5pm, and every 2nd Saturday somewhere else.
        </p>
      )}

      {value.map(s => (
        <div key={s.id} className="grid grid-cols-2 lg:grid-cols-[1fr_0.9fr_0.9fr_1fr_1.3fr_auto] gap-2 items-center rounded-xl border border-slate-100 bg-slate-50/40 lg:bg-transparent lg:border-0 p-2 lg:p-0">
          <label className="flex flex-col gap-1">
            <span className="lg:hidden text-[11px] font-medium text-slate-400">Day</span>
            <select value={s.day} onChange={e => update(s.id, { day: Number(e.target.value) })} className={cell}>
              {DAYS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="lg:hidden text-[11px] font-medium text-slate-400">Start</span>
            <input type="time" value={s.start} onChange={e => update(s.id, { start: e.target.value })} className={cell} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="lg:hidden text-[11px] font-medium text-slate-400">End</span>
            <input type="time" value={s.end} onChange={e => update(s.id, { end: e.target.value })} className={cell} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="lg:hidden text-[11px] font-medium text-slate-400">Repeat</span>
            <select value={s.repeat} onChange={e => update(s.id, { repeat: e.target.value as SessionSlot['repeat'] })} className={cell}>
              <option value="WEEKLY">Weekly</option>
              <option value="FORTNIGHTLY">Every 2 weeks</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="lg:hidden text-[11px] font-medium text-slate-400">Location</span>
            <select value={s.locationId} onChange={e => update(s.id, { locationId: e.target.value })} className={cell}>
              <option value="">Class location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onChange(value.filter(x => x.id !== s.id))}
            className="justify-self-end lg:justify-self-center text-slate-300 hover:text-red-500"
            aria-label="Remove this time"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, newSlot()])}
        className="self-start inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
      >
        <Plus className="h-4 w-4" /> Add a time
      </button>
    </div>
  )
}
