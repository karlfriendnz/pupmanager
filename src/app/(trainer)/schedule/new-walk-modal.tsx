'use client'

import { useEffect, useState } from 'react'
import { X, Plus, Trash2, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { useBookingConflicts, fetchBookingConflicts, conflictMessage } from '@/lib/use-booking-conflicts'

type ClientOption = { id: string; name: string; dogs?: { id: string; name: string }[] }
type Attendee = { clientId: string; dogId: string }

// "Buddies walk" create flow: a single standalone session (no package) with
// several dogs. The first attendee becomes the session's primary client/dog;
// the rest are attached as buddies. POSTs to /api/schedule/sessions.
export function NewWalkModal({
  clients,
  defaultStartDate,
  defaultStartTime,
  onClose,
  onCreated,
}: {
  clients: ClientOption[]
  defaultStartDate: string
  defaultStartTime?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('Group walk')
  const [date, setDate] = useState(defaultStartDate)
  const [time, setTime] = useState(defaultStartTime ?? '09:00')
  const [durationMins, setDurationMins] = useState('60')
  const [sessionType, setSessionType] = useState<'IN_PERSON' | 'VIRTUAL'>('IN_PERSON')
  const [location, setLocation] = useState('')
  const [weeksBetween, setWeeksBetween] = useState('1')
  const [occurrences, setOccurrences] = useState('1')
  // Start with two rows — a walk is a group by definition.
  const [attendees, setAttendees] = useState<Attendee[]>([
    { clientId: '', dogId: '' },
    { clientId: '', dogId: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { confirmBooking } = useBookingConflicts()
  // Live inline conflict hint WHILE the modal is open (a fresh check as the time
  // changes), in addition to the final check on save.
  const [conflictHint, setConflictHint] = useState<string | null>(null)

  const fieldCls = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  useEffect(() => {
    if (!date || !time) { setConflictHint(null); return }
    const startIso = new Date(`${date}T${time}`).toISOString()
    const mins = Math.max(5, Math.floor(Number(durationMins) || 60))
    let cancelled = false
    const timer = setTimeout(async () => {
      const data = await fetchBookingConflicts({ startIso, durationMins: mins })
      if (!cancelled) setConflictHint(conflictMessage(data))
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [date, time, durationMins])

  function setRow(i: number, patch: Partial<Attendee>) {
    setAttendees(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function dogsFor(clientId: string) {
    return clients.find(c => c.id === clientId)?.dogs ?? []
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const picked = attendees.filter(a => a.clientId)
    if (picked.length < 1) {
      setError('Add at least one dog to the walk.')
      return
    }
    if (!date || !time) {
      setError('Pick a date and time.')
      return
    }
    const scheduledAt = new Date(`${date}T${time}`).toISOString()
    const mins = Math.max(5, Math.floor(Number(durationMins) || 60))
    // Explicit confirm-to-override if this clashes with the trainer's own
    // sessions or a Google Calendar event. Walks are owner-run (unassigned).
    const proceed = await confirmBooking({ startIso: scheduledAt, durationMins: mins })
    if (!proceed) return

    setSaving(true)
    try {
      const res = await fetch('/api/schedule/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt,
          durationMins: mins,
          sessionType,
          title: title.trim() || 'Group walk',
          location: location.trim() || null,
          attendees: picked.map(a => ({ clientId: a.clientId, dogId: a.dogId || null })),
          weeksBetween: Math.max(1, Math.floor(Number(weeksBetween) || 1)),
          occurrences: Math.max(1, Math.floor(Number(occurrences) || 1)),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not create the walk.')
        return
      }
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">New group walk</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={fieldCls} placeholder="Group walk" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className={fieldCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Length (mins)</label>
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

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Location <span className="text-slate-400">(optional)</span></label>
            <input value={location} onChange={e => setLocation(e.target.value)} className={fieldCls} placeholder="e.g. Cornwall Park" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Repeats</label>
              <select value={weeksBetween} onChange={e => setWeeksBetween(e.target.value)} className={fieldCls}>
                <option value="1">Weekly</option>
                <option value="2">Every 2 weeks</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">How many walks</label>
              <input type="number" min={1} max={52} value={occurrences} onChange={e => setOccurrences(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 -mt-1">Set more than 1 to create a recurring walk series. You can add dogs to the whole series later.</p>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Dogs on the walk</label>
            <div className="flex flex-col gap-2">
              {attendees.map((a, i) => {
                const dogs = dogsFor(a.clientId)
                return (
                  <div key={i} className="flex gap-2 items-center">
                    <select
                      value={a.clientId}
                      onChange={e => setRow(i, { clientId: e.target.value, dogId: '' })}
                      className={fieldCls}
                    >
                      <option value="">Choose client…</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select
                      value={a.dogId}
                      onChange={e => setRow(i, { dogId: e.target.value })}
                      disabled={!a.clientId || dogs.length === 0}
                      className={`${fieldCls} disabled:bg-slate-50 disabled:text-slate-400`}
                    >
                      <option value="">{dogs.length ? 'Any dog' : 'No dogs'}</option>
                      {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    {attendees.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAttendees(rows => rows.filter((_, idx) => idx !== i))}
                        className="shrink-0 p-2 text-slate-400 hover:text-red-500"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setAttendees(rows => [...rows, { clientId: '', dogId: '' }])}
              className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Add another dog
            </button>
            <p className="text-[11px] text-slate-400 mt-1">The first dog is the main attendee; the rest join the group walk.</p>
          </div>

          {conflictHint && (
            <Alert variant="warning" className="flex items-start gap-2">
              <CalendarClock className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{conflictHint.replace(/\.?\s*Book anyway\?$/, '')} — you can still create it.</span>
            </Alert>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={saving}>Create walk</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
