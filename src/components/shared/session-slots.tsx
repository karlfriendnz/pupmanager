'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, X, ArrowRight, Info, ChevronDown, Check, Copy, GripVertical } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RecurrenceField } from '@/components/shared/recurrence-field'
import { bufferOptions } from '@/components/shared/buffer-field'
import { AddLocationModal } from '@/components/shared/add-location-modal'
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
  specialPrice: string // optional discounted price
  account: string // Xero account code
  requirePayment: boolean // true = require payment to book, false = don't
  assignedIds: string[] // team members running this session
  locationId: string // '' = none / inherit the class location
  repeat: string // iCalendar RRULE subset (see lib/recurrence.ts); '' = one-off
}

const DAYS = [
  { v: 1, label: 'Monday' }, { v: 2, label: 'Tuesday' }, { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' }, { v: 5, label: 'Friday' }, { v: 6, label: 'Saturday' }, { v: 0, label: 'Sunday' },
]

const GAP_HELP = 'Time you need after each session — travel, clean-up, a breather. Nothing can be booked into it.'

/** A blank slot. The times start empty rather than at a guessed 3–5pm: a
 *  prefilled time reads as a real one, and a trainer who doesn't notice it
 *  publishes a session at an hour they never chose. */
export function newSlot(): SessionSlot {
  return { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, startDate: '', day: 1, start: '', end: '', gap: '0', capacity: '', price: '', specialPrice: '', account: '', requirePayment: false, assignedIds: [], locationId: '', repeat: 'FREQ=WEEKLY' }
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
  region,
  onLocationCreated,
}: {
  value: SessionSlot[]
  onChange: (slots: SessionSlot[]) => void
  locations: { id: string; name: string }[]
  team?: { id: string; name: string | null; title: string | null }[]
  region?: string
  onLocationCreated?: (loc: { id: string; name: string; address: string | null }) => void
}) {
  // Xero accounts for the per-session Account autocomplete (fetched once).
  const [accounts, setAccounts] = useState<{ code: string; name: string }[]>([])
  useEffect(() => {
    let live = true
    fetch('/api/xero/shortlist').then(r => (r.ok ? r.json() : null)).then((d: { accounts?: { code: string; name: string }[] } | null) => {
      if (live && d?.accounts) setAccounts(d.accounts)
    }).catch(() => {})
    return () => { live = false }
  }, [])
  // Which slot (if any) is adding a new location via the popup.
  const [addLocForSlot, setAddLocForSlot] = useState<string | null>(null)
  function update(id: string, patch: Partial<SessionSlot>) {
    onChange(value.map(s => (s.id === id ? { ...s, ...patch } : s)))
  }
  function duplicate(id: string) {
    const i = value.findIndex(s => s.id === id)
    if (i < 0) return
    // Deep-copy the array field so the clone doesn't share state with the source.
    const copy = { ...value[i], assignedIds: [...value[i].assignedIds], id: `${Date.now()}-${Math.round(Math.random() * 1e6)}` }
    onChange([...value.slice(0, i + 1), copy, ...value.slice(i + 1)])
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = value.findIndex(s => s.id === active.id)
    const to = value.findIndex(s => s.id === over.id)
    if (from >= 0 && to >= 0) onChange(arrayMove(value, from, to))
  }
  const ctrl = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="md:col-span-2 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sessions</span>
        <span className="text-xs font-semibold text-slate-500">{value.length} {value.length === 1 ? 'time' : 'times'}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={value.map(s => s.id)} strategy={verticalListSortingStrategy}>
      {value.map(s => (
        <SortableSlot key={s.id} id={s.id}>
          {handle => (
          <div className="relative rounded-2xl border border-slate-200 bg-white p-4 pl-9 flex flex-col gap-3 shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
            <button type="button" {...handle.attributes} {...handle.listeners} className="absolute top-4 left-2.5 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none" aria-label="Drag to reorder">
              <GripVertical className="h-5 w-5" />
            </button>
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <button type="button" onClick={() => duplicate(s.id)} className="text-slate-300 hover:text-blue-600" aria-label="Duplicate this session"><Copy className="h-4 w-4" /></button>
              <button type="button" onClick={() => onChange(value.filter(x => x.id !== s.id))} className="text-slate-300 hover:text-red-500" aria-label="Remove this session"><X className="h-5 w-5" /></button>
            </div>

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

          <Row label="Pricing">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              {/* The account column only exists when Xero is connected with a
                  shortlist — same rule as the package-level picker. */}
              <div className={`grid ${accounts.length ? 'grid-cols-3' : 'grid-cols-2'} bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400`}>
                <span>Price</span><span>Special</span>{accounts.length > 0 && <span>Account</span>}
              </div>
              <div className={`grid ${accounts.length ? 'grid-cols-3' : 'grid-cols-2'} gap-2 p-2`}>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input value={s.price} onChange={e => update(s.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00" className="h-10 w-full rounded-lg border border-slate-200 pl-5 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input value={s.specialPrice} onChange={e => update(s.id, { specialPrice: e.target.value })} inputMode="decimal" placeholder="—" className="h-10 w-full rounded-lg border border-slate-200 pl-5 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {/* Pick from the shortlist, don't type a code against a
                    native datalist — the browser draws that list itself and it
                    looks nothing like the rest of the form. A code that isn't
                    on the shortlist any more is kept as its own option so
                    editing an old slot can't silently drop it. */}
                {accounts.length > 0 && (
                  <select
                    value={s.account}
                    onChange={e => update(s.id, { account: e.target.value })}
                    aria-label="Xero income account"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Default</option>
                    {accounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                    {s.account && !accounts.some(a => a.code === s.account) && (
                      <option value={s.account}>{s.account}</option>
                    )}
                  </select>
                )}
              </div>
            </div>
          </Row>

          <Row label="Payment">
            <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-xl">
              {([{ v: true, label: 'Require payment' }, { v: false, label: 'Don’t require' }] as const).map(o => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => update(s.id, { requirePayment: o.v })}
                  aria-pressed={s.requirePayment === o.v}
                  className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-all ${s.requirePayment === o.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {o.label}
                </button>
              ))}
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
            <div className="flex gap-2">
              <select value={s.locationId} onChange={e => update(s.id, { locationId: e.target.value })} className={ctrl + ' flex-1'}>
                <option value="">Choose location…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setAddLocForSlot(s.id)}
                title="Add a new location"
                aria-label="Add a new location"
                className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </Row>

            {team.length > 0 && (
              <Row label="Assigned to">
                <AssignSelect team={team} value={s.assignedIds} onChange={ids => update(s.id, { assignedIds: ids })} />
              </Row>
            )}
          </div>
          )}
        </SortableSlot>
      ))}
      </SortableContext>
      </DndContext>

      {addLocForSlot && (
        <AddLocationModal
          region={region}
          onClose={() => setAddLocForSlot(null)}
          onCreated={loc => {
            onLocationCreated?.(loc)
            update(addLocForSlot, { locationId: loc.id })
            setAddLocForSlot(null)
          }}
        />
      )}

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

// One draggable session card. Render-prop hands the drag handle's attributes +
// listeners to the caller so the handle can live wherever it wants in the card.
function SortableSlot({
  id,
  children,
}: {
  id: string
  children: (h: { attributes: ReturnType<typeof useSortable>['attributes']; listeners: ReturnType<typeof useSortable>['listeners'] }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return <div ref={setNodeRef} style={style}>{children({ attributes, listeners })}</div>
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
