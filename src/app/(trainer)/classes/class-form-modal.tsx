'use client'

import { useState, useEffect } from 'react'
import { useBookingConflicts } from '@/lib/use-booking-conflicts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { X } from 'lucide-react'
import { ImageUploadButton } from '@/components/image-uploader'
import { RequirePaymentField } from '@/components/shared/require-payment-field'

export type TeamMemberOption = {
  id: string
  name: string
  title: string | null
  isOwner: boolean
}

export type ClassInitial = {
  name?: string
  startDateIso?: string | null
  weeksBetween?: number
  sessionCount?: number
  durationMins?: number
  sessionType?: 'IN_PERSON' | 'VIRTUAL'
  priceCents?: number | null
  capacity?: number | null
  scheduleNote?: string | null
  defaultSessionFormId?: string | null
  imageUrl?: string | null
  assignedMembershipIds?: string[]
  requirePayment?: boolean | null
}

// ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input expects, in local time.
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Shared create/edit form for a class. One-step: captures the class's own
// settings (the backing group package is handled server-side).
export function ClassFormModal({
  mode,
  runId,
  initial,
  canReschedule = true,
  teamMembers = [],
  promptConnect = false,
  onClose,
  onSaved,
  onConnectPrompt,
}: {
  mode: 'create' | 'edit'
  runId?: string
  initial?: ClassInitial
  canReschedule?: boolean
  teamMembers?: TeamMemberOption[]
  // When a priced class is created and Stripe isn't connected yet, signal the
  // parent (with the class name) to pop the connect-Stripe modal instead of
  // just closing.
  promptConnect?: boolean
  onClose: () => void
  onSaved: () => void
  onConnectPrompt?: (name: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(toLocalInput(initial?.startDateIso) || '')
  const [weeksBetween, setWeeksBetween] = useState(String(initial?.weeksBetween ?? 1))
  const [sessionCount, setSessionCount] = useState(String(initial?.sessionCount ?? 6))
  const [durationMins, setDurationMins] = useState(String(initial?.durationMins ?? 60))
  const [sessionType, setSessionType] = useState<'IN_PERSON' | 'VIRTUAL'>(initial?.sessionType ?? 'IN_PERSON')
  const [price, setPrice] = useState(initial?.priceCents != null ? String(initial.priceCents / 100) : '')
  const [capacity, setCapacity] = useState(initial?.capacity != null ? String(initial.capacity) : '')
  const [scheduleNote, setScheduleNote] = useState(initial?.scheduleNote ?? '')
  const [defaultFormId, setDefaultFormId] = useState(initial?.defaultSessionFormId ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null)
  const [requirePayment, setRequirePayment] = useState<boolean | null>(initial?.requirePayment ?? null)
  const [assignedIds, setAssignedIds] = useState<string[]>(initial?.assignedMembershipIds ?? [])
  const [forms, setForms] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { confirmBooking } = useBookingConflicts()

  // Only worth showing the multi-select when the company has 2+ team members.
  const showTrainerPicker = teamMembers.length > 1

  function toggleTrainer(id: string) {
    setAssignedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/session-forms')
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => {
        if (!cancelled && Array.isArray(d)) {
          setForms(d.map((f) => ({ id: (f as { id: string }).id, name: (f as { name: string }).name })))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const scheduleLocked = mode === 'edit' && !canReschedule

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !startDate) {
      setError('Class name and first session date/time are required.')
      return
    }
    // Confirm-to-override if the first class session clashes with what the
    // assigned trainer (first assignee, else owner) already has.
    if (mode !== 'edit') {
      const firstAssignee = showTrainerPicker && assignedIds.length > 0 ? assignedIds[0] : undefined
      const proceed = await confirmBooking({
        startIso: new Date(startDate).toISOString(),
        durationMins: Math.max(5, Math.floor(Number(durationMins) || 60)),
        membershipId: firstAssignee,
      })
      if (!proceed) return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        startDate: new Date(startDate).toISOString(),
        sessionCount: Math.max(1, Math.floor(Number(sessionCount) || 1)),
        weeksBetween: Math.max(1, Math.floor(Number(weeksBetween) || 1)),
        durationMins: Math.max(5, Math.floor(Number(durationMins) || 60)),
        sessionType,
        priceCents: price.trim() ? Math.round(Number(price) * 100) : null,
        capacity: capacity.trim() ? Math.max(1, Math.floor(Number(capacity))) : null,
        scheduleNote: scheduleNote.trim() || null,
        defaultSessionFormId: defaultFormId || null,
        imageUrl: imageUrl || null,
        requirePayment,
        // Only send assignments when the picker is in play, so we don't clobber
        // existing rows for a solo company that never sees the selector.
        ...(showTrainerPicker && { assignedMembershipIds: assignedIds }),
      }
      const res = await fetch(mode === 'edit' ? `/api/class-runs/${runId}` : '/api/class-runs', {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : `Could not ${mode === 'edit' ? 'save' : 'create'} the class.`)
        return
      }
      // Just created a priced class and Stripe isn't connected → hand off to the
      // parent to pop the connect-Stripe modal over the list.
      if (mode === 'create' && promptConnect && payload.priceCents != null && onConnectPrompt) {
        onConnectPrompt(payload.name)
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">{mode === 'edit' ? 'Edit class' : 'New class'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          <Input label="Class name" placeholder="Puppy Class" value={name} onChange={e => setName(e.target.value)} />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">First session (date &amp; time)</label>
            <input type="datetime-local" value={startDate} disabled={scheduleLocked} onChange={e => setStartDate(e.target.value)} className={fieldCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Repeats</label>
              <select value={weeksBetween} disabled={scheduleLocked} onChange={e => setWeeksBetween(e.target.value)} className={fieldCls}>
                <option value="1">Weekly</option>
                <option value="2">Every 2 weeks</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">For how many weeks</label>
              <input type="number" min={1} max={52} value={sessionCount} disabled={scheduleLocked} onChange={e => setSessionCount(e.target.value)} className={fieldCls} />
            </div>
          </div>

          {scheduleLocked && (
            <p className="text-[11px] text-amber-600 -mt-1">Schedule is locked — this class already has attendance recorded.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Session length (mins)</label>
              <input type="number" min={5} max={600} step={5} value={durationMins} onChange={e => setDurationMins(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Format</label>
              <select value={sessionType} onChange={e => setSessionType(e.target.value as 'IN_PERSON' | 'VIRTUAL')} className={fieldCls}>
                <option value="IN_PERSON">In person</option>
                <option value="VIRTUAL">Virtual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Price <span className="text-slate-400">(optional)</span></label>
              <input type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 180" className={fieldCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity <span className="text-slate-400">(optional)</span></label>
              <input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Unlimited" className={fieldCls} />
            </div>
          </div>

          <RequirePaymentField value={requirePayment} onChange={setRequirePayment} />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Default session form <span className="text-slate-400">(optional)</span></label>
            <select value={defaultFormId} onChange={e => setDefaultFormId(e.target.value)} className={fieldCls}>
              <option value="">No form</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Used to write up each session. You can change it on a single session later.</p>
          </div>

          <Input label="Schedule note (optional)" placeholder="Thursdays 4:00pm" value={scheduleNote} onChange={e => setScheduleNote(e.target.value)} />

          {/* Cover image */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Class image <span className="text-slate-400">(optional)</span></label>
            {imageUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className="h-24 w-full max-w-[16rem] rounded-xl object-cover border border-slate-200" />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <ImageUploadButton onUploaded={urls => { if (urls[0]) setImageUrl(urls[0]) }} />
                <span className="text-xs text-slate-400">Add a cover photo for this class.</span>
              </div>
            )}
          </div>

          {/* Assigned trainers — only when there's a team to choose from */}
          {showTrainerPicker && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Trainers <span className="text-slate-400">(optional)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {teamMembers.map(m => {
                  const on = assignedIds.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleTrainer(m.id)}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                        on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {m.name}{m.title ? <span className="opacity-60"> · {m.title}</span> : null}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Tap to assign one or more team members to this class.</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={saving}>{mode === 'edit' ? 'Save changes' : 'Create class'}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
