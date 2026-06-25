'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { Users, UserPlus, X, CalendarDays, ClipboardCheck, Pencil, Trash2, Loader2 } from 'lucide-react'
import { ClassFormModal, type TeamMemberOption } from '../class-form-modal'

type RunStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
type AssignedTrainer = { membershipId: string; name: string; title: string | null }
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
  priceCents: number | null
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  weeksBetween: number
  sessionCount: number
  defaultSessionFormId: string | null
  hasAttendance: boolean
  imageUrl: string | null
  assignedMembershipIds: string[]
  assignedTrainers: AssignedTrainer[]
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


export function RunDetail({
  run,
  sessions,
  enrollments,
  clients,
  teamMembers,
}: {
  run: Run
  sessions: SessionRow[]
  enrollments: Enrollment[]
  clients: ClientOpt[]
  teamMembers: TeamMemberOption[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setError(null)
    setDeleting(true)
    const res = await fetch(`/api/class-runs/${run.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/classes')
      router.refresh()
      return
    }
    setError('Could not delete this class — try again.')
    setDeleting(false)
    setConfirmingDelete(false)
  }

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
        subtitle={run.scheduleNote ? `${run.scheduleNote} · ${seatsLabel}` : seatsLabel}
        back={{ href: '/classes', label: 'Classes' }}
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Class controls — full width below the header so the title has room */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <select
          value={run.status}
          onChange={e => setStatus(e.target.value as RunStatus)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {(['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'] as const).map(s => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              title="Delete class"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            >
              <Trash2 className="h-4 w-4 text-rose-500" />
              <span>Delete</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-600 hidden sm:inline">Delete this class?</span>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                aria-label="Cancel"
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Yes, delete
              </button>
            </div>
          )}
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      {run.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={run.imageUrl}
          alt={run.name}
          className="w-full h-40 sm:h-52 object-cover rounded-2xl border border-slate-200 mb-5"
        />
      )}

      {/* Class details */}
      <Card className="mb-5">
        <CardBody className="py-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <Detail label="Schedule" value={run.scheduleNote || 'Weekly'} />
            <Detail label="Starts" value={new Date(run.startDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
            <Detail label="Sessions" value={String(sessions.length)} />
            <Detail label="Length" value={`${run.durationMins} min`} />
            <Detail label="Format" value={run.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
            <Detail label="Price" value={run.priceCents != null ? `$${(run.priceCents / 100).toFixed(run.priceCents % 100 === 0 ? 0 : 2)}` : '—'} />
          </div>
          {run.assignedTrainers.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Trainers</p>
              <div className="flex flex-wrap gap-1.5">
                {run.assignedTrainers.map(t => (
                  <span
                    key={t.membershipId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1"
                  >
                    {t.name}{t.title ? <span className="text-blue-400 font-normal">· {t.title}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(run.allowDropIn || run.allowWaitlist) && (
            <p className="text-xs text-slate-400 mt-3">
              {run.allowDropIn && 'Drop-ins allowed'}
              {run.allowDropIn && run.allowWaitlist && ' · '}
              {run.allowWaitlist && 'Waitlist enabled'}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Sessions (left) · Clients (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Sessions */}
        <Card>
          <CardBody className="py-5">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-slate-400" /> Sessions
              <span className="text-sm font-normal text-slate-500">({sessions.length})</span>
            </h2>
            <ul className="divide-y divide-slate-100">
              {sessions.map(s => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">Session {s.sessionIndex ?? '—'}</p>
                    <p className="text-xs text-slate-500" suppressHydrationWarning>{new Date(s.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <Link
                    href={`/classes/${run.id}/sessions/${s.id}`}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    <ClipboardCheck className="h-4 w-4" /> Open
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {/* Roster / clients */}
        <Card>
          <CardBody className="py-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" /> Clients
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
                  <li key={e.id} className="flex items-center gap-3 py-3">
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
      </div>

      {editing && (
        <ClassFormModal
          mode="edit"
          runId={run.id}
          canReschedule={!run.hasAttendance}
          teamMembers={teamMembers}
          initial={{
            name: run.name,
            startDateIso: run.startDate,
            weeksBetween: run.weeksBetween,
            sessionCount: run.sessionCount,
            durationMins: run.durationMins,
            sessionType: run.sessionType,
            priceCents: run.priceCents,
            capacity: run.capacity,
            scheduleNote: run.scheduleNote,
            defaultSessionFormId: run.defaultSessionFormId,
            imageUrl: run.imageUrl,
            assignedMembershipIds: run.assignedMembershipIds,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            router.refresh()
          }}
        />
      )}

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

      </div>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {/* Dates render in the viewer's locale/timezone, which differs from the
          server's UTC SSR — suppress the expected hydration text mismatch. */}
      <p className="text-sm font-medium text-slate-800 mt-0.5 truncate" suppressHydrationWarning>{value}</p>
    </div>
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
  const [notify, setNotify] = useState(true)
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
        body: JSON.stringify({ clientId, dogId: c?.dogId ?? null, type, notify }),
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
            <p className="text-sm text-slate-500">
              {clients.length === 0
                ? "You don't have any clients yet — add a client first, then enrol them here."
                : 'Every active client is already enrolled.'}
            </p>
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
              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={e => setNotify(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm text-slate-700">Notify the client they&apos;re enrolled</span>
              </label>
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

