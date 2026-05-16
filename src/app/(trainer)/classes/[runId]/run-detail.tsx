'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { Users, UserPlus, X, CalendarDays, ClipboardCheck } from 'lucide-react'

type RunStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
type Run = {
  id: string
  name: string
  scheduleNote: string | null
  startDate: string
  status: RunStatus
  capacity: number | null
  packageName: string
  allowDropIn: boolean
  allowWaitlist: boolean
}
type SessionRow = { id: string; title: string; scheduledAt: string; sessionIndex: number | null; status: string }
type Enrollment = {
  id: string
  status: 'ENROLLED' | 'WAITLISTED' | 'WITHDRAWN' | 'COMPLETED'
  type: 'FULL' | 'DROP_IN'
  waitlistPosition: number | null
  source: string
  clientName: string
  dogName: string | null
}
type ClientOpt = { id: string; name: string; dogId: string | null; dogName: string | null }

const ATT_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP'] as const
type AttStatus = (typeof ATT_STATUSES)[number]

export function RunDetail({
  run,
  sessions,
  enrollments,
  clients,
}: {
  run: Run
  sessions: SessionRow[]
  enrollments: Enrollment[]
  clients: ClientOpt[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [openSession, setOpenSession] = useState<SessionRow | null>(null)

  const enrolled = enrollments.filter(e => e.status === 'ENROLLED')
  const waitlisted = enrollments.filter(e => e.status === 'WAITLISTED')
  const seatsLabel =
    run.capacity == null ? `${enrolled.length} enrolled` : `${enrolled.length} / ${run.capacity}`

  async function setStatus(status: RunStatus) {
    setError(null)
    const res = await fetch(`/api/class-runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) setError('Could not update the class status.')
    else router.refresh()
  }

  async function withdraw(enrollmentId: string) {
    setError(null)
    const res = await fetch(`/api/class-runs/${run.id}/enrollments/${enrollmentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) setError('Could not withdraw that enrolment.')
    else router.refresh()
  }

  return (
    <>
      <PageHeader
        title={run.name}
        subtitle={`${run.packageName} · ${run.scheduleNote || new Date(run.startDate).toLocaleDateString()}`}
        back={{ href: '/classes', label: 'Classes' }}
        actions={
          <select
            value={run.status}
            onChange={e => setStatus(e.target.value as RunStatus)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'] as const).map(s => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
        }
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Roster */}
      <Card className="mb-4">
        <CardBody>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" /> Roster
              <span className="text-sm font-normal text-slate-500">({seatsLabel})</span>
            </h2>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" /> Enrol client
            </Button>
          </div>

          {enrolled.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No one enrolled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {enrolled.map(e => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{e.clientName}</p>
                    <p className="text-xs text-slate-500">
                      {e.dogName ?? 'No dog'}
                      {e.type === 'DROP_IN' && <span className="ml-1.5 text-amber-600">· drop-in</span>}
                      {e.source === 'SELF_SERVE' && <span className="ml-1.5 text-slate-400">· self-enrolled</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => withdraw(e.id)}
                    className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}

          {waitlisted.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Waitlist ({waitlisted.length})
              </p>
              <ul className="divide-y divide-slate-100">
                {waitlisted.map(e => (
                  <li key={e.id} className="flex items-center gap-3 py-2">
                    <span className="text-xs text-slate-400 w-5">{e.waitlistPosition}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700 truncate">{e.clientName}</p>
                    </div>
                    <button
                      onClick={() => withdraw(e.id)}
                      className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Sessions */}
      <Card>
        <CardBody>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
            <CalendarDays className="h-4 w-4 text-slate-400" /> Sessions
          </h2>
          <ul className="divide-y divide-slate-100">
            {sessions.map(s => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="text-xs text-slate-400 w-6">{s.sessionIndex ?? '–'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{s.title}</p>
                  <p className="text-xs text-slate-500">{new Date(s.scheduledAt).toLocaleString()}</p>
                </div>
                <Button variant="ghost" onClick={() => setOpenSession(s)}>
                  <ClipboardCheck className="h-4 w-4" /> Attendance
                </Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {adding && (
        <EnrolModal
          runId={run.id}
          clients={clients}
          allowDropIn={run.allowDropIn}
          existing={new Set(enrollments.filter(e => e.status !== 'WITHDRAWN').map(e => e.clientName))}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            router.refresh()
          }}
        />
      )}

      {openSession && (
        <AttendanceModal
          runId={run.id}
          session={openSession}
          onClose={() => setOpenSession(null)}
        />
      )}
      </div>
    </>
  )
}

function EnrolModal({
  runId,
  clients,
  allowDropIn,
  existing,
  onClose,
  onDone,
}: {
  runId: string
  clients: ClientOpt[]
  allowDropIn: boolean
  existing: Set<string>
  onClose: () => void
  onDone: () => void
}) {
  const candidates = clients.filter(c => !existing.has(c.name))
  const [clientId, setClientId] = useState(candidates[0]?.id ?? '')
  const [type, setType] = useState<'FULL' | 'DROP_IN'>('FULL')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!clientId) {
      setError('Pick a client.')
      return
    }
    const c = clients.find(x => x.id === clientId)
    setSaving(true)
    try {
      const res = await fetch(`/api/class-runs/${runId}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, dogId: c?.dogId ?? null, type }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not enrol that client.')
        return
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Enrol a client</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500">Every active client is already enrolled.</p>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Client</label>
                <select
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {candidates.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.dogName ? ` · ${c.dogName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {allowDropIn && (
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Enrolment type</label>
                  <div className="flex gap-2">
                    {(['FULL', 'DROP_IN'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={`flex-1 text-center py-2 rounded-xl border text-sm transition-colors ${
                          type === t
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {t === 'FULL' ? 'Full run' : 'Drop-in'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button type="submit" loading={saving}>Enrol</Button>
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}

type RosterRow = {
  enrollmentId: string
  clientName: string
  dogName: string | null
  type: string
  attendance: { status: AttStatus; note: string | null; scores: Record<string, unknown> } | null
}

function AttendanceModal({
  runId,
  session,
  onClose,
}: {
  runId: string
  session: SessionRow
  onClose: () => void
}) {
  const [rows, setRows] = useState<RosterRow[] | null>(null)
  const [draft, setDraft] = useState<Record<string, { status: AttStatus; note: string; rating: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/class-runs/${runId}/sessions/${session.id}/attendance`)
    if (!res.ok) {
      setError('Could not load the roster.')
      return
    }
    const data: RosterRow[] = await res.json()
    setRows(data)
    const d: Record<string, { status: AttStatus; note: string; rating: string }> = {}
    for (const r of data) {
      const sc = (r.attendance?.scores ?? {}) as { rating?: number }
      d[r.enrollmentId] = {
        status: r.attendance?.status ?? 'PRESENT',
        note: r.attendance?.note ?? '',
        rating: sc.rating != null ? String(sc.rating) : '',
      }
    }
    setDraft(d)
  }, [runId, session.id])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!rows) return
    setSaving(true)
    setError(null)
    try {
      const records = rows.map(r => {
        const d = draft[r.enrollmentId]
        const ratingNum = d.rating.trim() ? Number(d.rating) : null
        return {
          enrollmentId: r.enrollmentId,
          status: d.status,
          note: d.note.trim() || null,
          scores: ratingNum != null && !Number.isNaN(ratingNum) ? { rating: ratingNum } : {},
        }
      })
      const res = await fetch(`/api/class-runs/${runId}/sessions/${session.id}/attendance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })
      if (!res.ok) {
        setError('Could not save attendance.')
        return
      }
      setSaved(true)
      setTimeout(onClose, 600)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <h2 className="font-semibold text-slate-900">{session.title}</h2>
            <p className="text-xs text-slate-500">{new Date(session.scheduledAt).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          {error && <Alert variant="error" className="mb-3">{error}</Alert>}
          {saved && <Alert variant="success" className="mb-3">Attendance saved.</Alert>}
          {!rows ? (
            <p className="text-sm text-slate-500 py-6 text-center">Loading roster…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No enrolled clients to mark.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map(r => {
                const d = draft[r.enrollmentId]
                if (!d) return null
                return (
                  <div key={r.enrollmentId} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-slate-900">
                        {r.clientName}
                        {r.dogName && <span className="text-slate-500 font-normal"> · {r.dogName}</span>}
                      </p>
                      <select
                        value={d.status}
                        onChange={e =>
                          setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, status: e.target.value as AttStatus } }))
                        }
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {ATT_STATUSES.map(s => (
                          <option key={s} value={s}>{s.toLowerCase()}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        max={5}
                        placeholder="Score 1–5"
                        value={d.rating}
                        onChange={e =>
                          setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, rating: e.target.value } }))
                        }
                        className="w-24 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Note for this dog (optional)"
                        value={d.note}
                        onChange={e =>
                          setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, note: e.target.value } }))
                        }
                        className="flex-1 h-9 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )
              })}
              <div className="flex gap-2 pt-1">
                <Button onClick={save} loading={saving}>Save attendance</Button>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
