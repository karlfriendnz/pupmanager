'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, X, GripVertical, Clock, CalendarCheck, UserCheck, Trash2, Pencil } from 'lucide-react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Status = 'WAITING' | 'CONTACTED' | 'SCHEDULED' | 'REMOVED'
type Entry = {
  id: string
  clientId: string | null
  name: string
  email: string | null
  phone: string | null
  packageId: string | null
  packageName: string | null
  request: string | null
  sessionType: 'IN_PERSON' | 'VIRTUAL' | null
  preferredDays: number[]
  preferredTimeStart: string | null
  preferredTimeEnd: string | null
  earliestStart: string | null
  notes: string | null
  status: Status
  contactedAt: string | null
  createdAt: string
}
type ClientOpt = { id: string; name: string }
type PackageOpt = { id: string; name: string }

const DAYS = [
  { n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' },
  { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 7, l: 'Sun' },
]
const STATUS_STYLE: Record<Status, string> = {
  WAITING: 'bg-amber-50 text-amber-700',
  CONTACTED: 'bg-blue-50 text-blue-700',
  SCHEDULED: 'bg-emerald-50 text-emerald-700',
  REMOVED: 'bg-slate-100 text-slate-500',
}
const FILTERS: Array<{ key: Status | 'ALL'; label: string }> = [
  { key: 'WAITING', label: 'Waiting' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'ALL', label: 'All' },
]

function prefsSummary(e: Entry): string {
  const parts: string[] = []
  if (e.preferredDays.length > 0) {
    parts.push(e.preferredDays.sort((a, b) => a - b).map(d => DAYS[d - 1]?.l).join('/'))
  }
  if (e.preferredTimeStart || e.preferredTimeEnd) {
    parts.push(`${e.preferredTimeStart ?? '…'}–${e.preferredTimeEnd ?? '…'}`)
  }
  if (e.earliestStart) parts.push(`from ${new Date(e.earliestStart).toLocaleDateString()}`)
  return parts.join(' · ')
}

export function WaitlistView({
  initialEntries,
  clients,
  packages,
}: {
  initialEntries: Entry[]
  clients: ClientOpt[]
  packages: PackageOpt[]
}) {
  const router = useRouter()
  const [entries, setEntries] = useState(initialEntries)
  const [filter, setFilter] = useState<Status | 'ALL'>('WAITING')
  const [editing, setEditing] = useState<Entry | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const visible = useMemo(
    () => entries.filter(e => (filter === 'ALL' ? true : e.status === filter)),
    [entries, filter],
  )

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`/api/waitlist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { setError('Could not update that entry.'); return }
    router.refresh()
  }

  async function remove(id: string) {
    setError(null)
    const res = await fetch(`/api/waitlist/${id}`, { method: 'DELETE' })
    if (!res.ok) { setError('Could not remove that entry.'); return }
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setEntries(prev => {
      const oldIndex = prev.findIndex(e => e.id === active.id)
      const newIndex = prev.findIndex(e => e.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      void fetch('/api/waitlist/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map(e => e.id) }),
      })
      return next
    })
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <p className="text-sm text-slate-500 max-w-md">
          People you want to take on but have no slot for yet — drag to prioritise, book when one opens.
        </p>
        <Button onClick={() => setShowAdd(true)} className="flex-shrink-0">
          <Plus className="h-4 w-4" /> Add to waitlist
        </Button>
      </div>
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

        <div className="flex gap-1.5 mb-5 flex-wrap">
          {FILTERS.map(f => {
            const count = f.key === 'ALL' ? entries.length : entries.filter(e => e.status === f.key).length
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  filter === f.key
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {f.label} <span className="text-slate-400">{count}</span>
              </button>
            )
          })}
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardBody className="py-12 text-center text-slate-400">
              <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {filter === 'WAITING' ? 'No one is waiting right now.' : 'Nothing here.'}
              </p>
            </CardBody>
          </Card>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visible.map(e => e.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-3">
                {visible.map(e => (
                  <Row
                    key={e.id}
                    e={e}
                    onContacted={() => patch(e.id, { status: 'CONTACTED' })}
                    onScheduled={() => patch(e.id, { status: 'SCHEDULED' })}
                    onReopen={() => patch(e.id, { status: 'WAITING' })}
                    onRemove={() => remove(e.id)}
                    onEdit={() => setEditing(e)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

      {(showAdd || editing) && (
        <EntryModal
          existing={editing}
          clients={clients}
          packages={packages}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={() => { setShowAdd(false); setEditing(null); router.refresh() }}
        />
      )}
    </div>
  )
}

function Row({
  e, onContacted, onScheduled, onReopen, onRemove, onEdit,
}: {
  e: Entry
  onContacted: () => void
  onScheduled: () => void
  onReopen: () => void
  onRemove: () => void
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const want = e.packageName || e.request || 'Any package'
  const prefs = prefsSummary(e)

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardBody className="py-4">
          <div className="flex items-start gap-3">
            <button
              {...attributes}
              {...listeners}
              className="mt-0.5 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0"
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-slate-900 truncate">{e.name}</p>
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[e.status]}`}>
                  {e.status.toLowerCase()}
                </span>
                <span className="text-[11px] text-slate-400">
                  {e.clientId ? 'client' : 'prospect'}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-0.5 truncate">{want}</p>
              {prefs && <p className="text-xs text-slate-400 mt-0.5">{prefs}</p>}
              {(e.email || e.phone) && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {[e.email, e.phone].filter(Boolean).join(' · ')}
                </p>
              )}
              {e.notes && <p className="text-xs text-slate-500 mt-1 italic">{e.notes}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div className="flex items-center gap-1">
                {e.clientId ? (
                  <Link
                    href={`/clients/${e.clientId}`}
                    onClick={onScheduled}
                    className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg inline-flex items-center gap-1"
                    title="Open client to assign a package, marks Scheduled"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" /> Book
                  </Link>
                ) : (
                  <Link
                    href="/enquiries"
                    onClick={onScheduled}
                    className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg inline-flex items-center gap-1"
                    title="Convert via enquiries, marks Scheduled"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" /> Book
                  </Link>
                )}
                <button onClick={onEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50" aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={onRemove} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50" aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {e.status === 'WAITING' && (
                <button onClick={onContacted} className="text-[11px] text-slate-500 hover:text-blue-600 inline-flex items-center gap-1">
                  <UserCheck className="h-3 w-3" /> Mark contacted
                </button>
              )}
              {(e.status === 'CONTACTED' || e.status === 'REMOVED' || e.status === 'SCHEDULED') && (
                <button onClick={onReopen} className="text-[11px] text-slate-400 hover:text-amber-600">
                  Back to waiting
                </button>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function EntryModal({
  existing, clients, packages, onClose, onSaved,
}: {
  existing: Entry | null
  clients: ClientOpt[]
  packages: PackageOpt[]
  onClose: () => void
  onSaved: () => void
}) {
  const [isClient, setIsClient] = useState<boolean>(existing ? !!existing.clientId : true)
  const [clientId, setClientId] = useState(existing?.clientId ?? clients[0]?.id ?? '')
  const [name, setName] = useState(existing && !existing.clientId ? existing.name : '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [packageId, setPackageId] = useState(existing?.packageId ?? '')
  const [request, setRequest] = useState(existing?.request ?? '')
  const [sessionType, setSessionType] = useState<'' | 'IN_PERSON' | 'VIRTUAL'>(existing?.sessionType ?? '')
  const [days, setDays] = useState<number[]>(existing?.preferredDays ?? [])
  const [tStart, setTStart] = useState(existing?.preferredTimeStart ?? '')
  const [tEnd, setTEnd] = useState(existing?.preferredTimeEnd ?? '')
  const [earliest, setEarliest] = useState(existing?.earliestStart ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function toggleDay(n: number) {
    setDays(prev => (prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n]))
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (isClient && !clientId) { setError('Pick a client.'); return }
    if (!isClient && !name.trim()) { setError('Enter a name.'); return }
    setSaving(true)
    try {
      const body = {
        clientId: isClient ? clientId : null,
        name: isClient ? undefined : name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        packageId: packageId || null,
        request: request.trim() || null,
        sessionType: sessionType || null,
        preferredDays: days,
        preferredTimeStart: tStart || null,
        preferredTimeEnd: tEnd || null,
        earliestStart: earliest || null,
        notes: notes.trim() || null,
      }
      const res = await fetch(existing ? `/api/waitlist/${existing.id}` : '/api/waitlist', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof b.error === 'string' ? b.error : 'Could not save.')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">{existing ? 'Edit entry' : 'Add to waitlist'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          {!existing && (
            <div className="flex gap-2">
              {([['Existing client', true], ['Prospect', false]] as const).map(([label, val]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setIsClient(val)}
                  className={`flex-1 text-center py-2 rounded-xl border text-sm transition-colors ${
                    isClient === val ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {isClient ? (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Client</label>
              <select
                value={clientId}
                onChange={ev => setClientId(ev.target.value)}
                disabled={!!existing}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              >
                {clients.length === 0 && <option value="">No active clients</option>}
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <Input label="Name" value={name} onChange={ev => setName(ev.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Email (optional)" type="email" value={email} onChange={ev => setEmail(ev.target.value)} />
                <Input label="Phone (optional)" value={phone} onChange={ev => setPhone(ev.target.value)} />
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Package of interest (optional)</label>
            <select
              value={packageId}
              onChange={ev => setPackageId(ev.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Any / not sure —</option>
              {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">What they want (optional)</label>
            <textarea
              value={request}
              onChange={ev => setRequest(ev.target.value)}
              rows={2}
              placeholder="e.g. 6-week reactive course, weekday evenings"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Preferred days</label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(d => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    days.includes(d.n)
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {d.l}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Earliest time</label>
              <input type="time" value={tStart} onChange={ev => setTStart(ev.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Latest time</label>
              <input type="time" value={tEnd} onChange={ev => setTEnd(ev.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Earliest start date</label>
              <input type="date" value={earliest} onChange={ev => setEarliest(ev.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Session type</label>
              <select
                value={sessionType}
                onChange={ev => setSessionType(ev.target.value as '' | 'IN_PERSON' | 'VIRTUAL')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any</option>
                <option value="IN_PERSON">In person</option>
                <option value="VIRTUAL">Virtual</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={ev => setNotes(ev.target.value)}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" loading={saving}>{existing ? 'Save' : 'Add'}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
