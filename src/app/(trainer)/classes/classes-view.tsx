'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { Plus, X, GraduationCap, Users, ChevronRight } from 'lucide-react'

type RunRow = {
  id: string
  name: string
  scheduleNote: string | null
  startDate: string
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  sessionCount: number
  enrolledCount: number
  capacity: number | null
}

const STATUS_STYLE: Record<RunRow['status'], string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700',
  RUNNING: 'bg-emerald-50 text-emerald-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-600',
}

export function ClassesView({ runs }: { runs: RunRow[] }) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="Run a class — pick the day, time and how many weeks. Clients enrol into one shared timetable with a roster, capacity and waitlist."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New class
          </Button>
        }
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {runs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10 px-4">
              <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No classes yet</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                Create your first class — e.g. &ldquo;Puppy Class, Thursdays 4pm for 6 weeks&rdquo;.
              </p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New class
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map(r => (
            <Link key={r.id} href={`/classes/${r.id}`} className="block">
              <Card className="hover:border-blue-200 transition-colors">
                <CardBody className="py-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
                      <GraduationCap className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900 truncate">{r.name}</p>
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>
                          {r.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(r.startDate).toLocaleDateString()} ·{' '}
                        {r.scheduleNote || `${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 flex-shrink-0">
                      <Users className="h-4 w-4 text-slate-400" />
                      {r.enrolledCount}
                      {r.capacity != null && <span className="text-slate-400">/ {r.capacity}</span>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateClassModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            router.refresh()
          }}
        />
      )}
      </div>
    </>
  )
}

// One-step class creation — no package step. Captures the class's own settings
// (the backing group package is created transparently server-side).
export function CreateClassModal({
  onClose,
  onCreated,
  initialStart,
}: {
  onClose: () => void
  onCreated: () => void
  initialStart?: string // datetime-local value to prefill (e.g. from the schedule)
}) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(initialStart ?? '')
  const [weeksBetween, setWeeksBetween] = useState('1')
  const [sessionCount, setSessionCount] = useState('6')
  const [durationMins, setDurationMins] = useState('60')
  const [sessionType, setSessionType] = useState<'IN_PERSON' | 'VIRTUAL'>('IN_PERSON')
  const [price, setPrice] = useState('')
  const [capacity, setCapacity] = useState('')
  const [scheduleNote, setScheduleNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !startDate) {
      setError('Class name and first session date/time are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/class-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          startDate: new Date(startDate).toISOString(),
          sessionCount: Math.max(1, Math.floor(Number(sessionCount) || 1)),
          weeksBetween: Math.max(1, Math.floor(Number(weeksBetween) || 1)),
          durationMins: Math.max(5, Math.floor(Number(durationMins) || 60)),
          sessionType,
          priceCents: price.trim() ? Math.round(Number(price) * 100) : null,
          capacity: capacity.trim() ? Math.max(1, Math.floor(Number(capacity))) : null,
          scheduleNote: scheduleNote.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not create the class.')
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
          <h2 className="font-semibold text-slate-900">New class</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          <Input label="Class name" placeholder="Puppy Class" value={name} onChange={e => setName(e.target.value)} />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">First session (date &amp; time)</label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Repeats</label>
              <select
                value={weeksBetween}
                onChange={e => setWeeksBetween(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">Weekly</option>
                <option value="2">Every 2 weeks</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">For how many weeks</label>
              <input
                type="number" min={1} max={52}
                value={sessionCount}
                onChange={e => setSessionCount(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Session length (mins)</label>
              <input
                type="number" min={5} max={600} step={5}
                value={durationMins}
                onChange={e => setDurationMins(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Format</label>
              <select
                value={sessionType}
                onChange={e => setSessionType(e.target.value as 'IN_PERSON' | 'VIRTUAL')}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="IN_PERSON">In person</option>
                <option value="VIRTUAL">Virtual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Price <span className="text-slate-400">(optional)</span></label>
              <input
                type="number" min={0} step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 180"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity <span className="text-slate-400">(optional)</span></label>
              <input
                type="number" min={1}
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                placeholder="Unlimited"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <Input
            label="Schedule note (optional)"
            placeholder="Thursdays 4:00pm"
            value={scheduleNote}
            onChange={e => setScheduleNote(e.target.value)}
          />

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={saving}>Create class</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
