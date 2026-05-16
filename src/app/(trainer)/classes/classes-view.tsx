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

type GroupPackage = { id: string; name: string; sessionCount: number; capacity: number | null }
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

export function ClassesView({
  groupPackages,
  runs,
}: {
  groupPackages: GroupPackage[]
  runs: RunRow[]
}) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle="Schedule a cohort of a group package — one shared timetable, a roster, capacity and waitlist."
        actions={
          groupPackages.length > 0 ? (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New class run
            </Button>
          ) : undefined
        }
      />

      {groupPackages.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10 px-4">
              <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No group packages yet</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                Create a package and tick &ldquo;This is a group class&rdquo; on it, then come back here to schedule a run.
              </p>
              <Link href="/packages" className="inline-block mt-4">
                <Button variant="ghost">Go to packages</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-center text-sm text-slate-500 py-10">
              No class runs yet. Create your first one.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map(r => (
            <Link key={r.id} href={`/classes/${r.id}`}>
              <Card className="hover:border-blue-100 transition-colors">
                <CardBody>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
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
        <CreateRunModal
          groupPackages={groupPackages}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function CreateRunModal({
  groupPackages,
  onClose,
  onCreated,
}: {
  groupPackages: GroupPackage[]
  onClose: () => void
  onCreated: () => void
}) {
  const [packageId, setPackageId] = useState(groupPackages[0]?.id ?? '')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [scheduleNote, setScheduleNote] = useState('')
  const [capacity, setCapacity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!packageId || !name.trim() || !startDate) {
      setError('Package, name and start date are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/class-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId,
          name: name.trim(),
          startDate: new Date(startDate).toISOString(),
          scheduleNote: scheduleNote.trim() || null,
          capacity: capacity.trim() ? Math.max(0, Math.floor(Number(capacity))) : null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not create the class run.')
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
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New class run</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Group package</label>
            <select
              value={packageId}
              onChange={e => setPackageId(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {groupPackages.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sessionCount} sessions)
                </option>
              ))}
            </select>
          </div>

          <Input label="Class name" placeholder="Spring Puppy Class" value={name} onChange={e => setName(e.target.value)} />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">First session</label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">Following sessions are spaced by the package&apos;s weeks-between.</p>
          </div>

          <Input
            label="Schedule note (optional)"
            placeholder="Tuesdays 6:00pm"
            value={scheduleNote}
            onChange={e => setScheduleNote(e.target.value)}
          />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity override (optional)</label>
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={e => setCapacity(e.target.value)}
              placeholder="Defaults to the package capacity"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={saving}>Create run</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
