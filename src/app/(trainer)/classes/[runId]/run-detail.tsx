'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { Users, UserPlus, X, CalendarDays, ClipboardCheck, Pencil, Trash2, Loader2, Info } from 'lucide-react'
import { ClassFormModal, type TeamMemberOption } from '../class-form-modal'

type Tab = 'details' | 'clients'
type RunStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
type EnrollStatus = 'ENROLLED' | 'WAITLISTED' | 'WITHDRAWN' | 'COMPLETED'
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
  status: EnrollStatus
  type: 'FULL' | 'DROP_IN'
  waitlistPosition: number | null
  source: string
  clientId: string
  clientName: string
  dogName: string | null
  dogPhotoUrl: string | null
  attendedCount: number
  markedCount: number
}
type ClientOpt = { id: string; name: string; dogId: string | null; dogName: string | null }

const ENROLL_BADGE: Record<EnrollStatus, string> = {
  ENROLLED: 'bg-emerald-50 text-emerald-700',
  WAITLISTED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-blue-50 text-blue-700',
  WITHDRAWN: 'bg-slate-100 text-slate-500',
}

function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return '—'
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

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
  const [tab, setTab] = useState<Tab>('details')
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
  const present = enrollments.filter(e => e.status === 'ENROLLED' || e.status === 'WAITLISTED')
  const past = enrollments.filter(e => e.status === 'WITHDRAWN' || e.status === 'COMPLETED')
  const seatsLabel =
    run.capacity == null ? `${enrolled.length} enrolled` : `${enrolled.length} / ${run.capacity}`
  const spotsLeft = run.capacity == null ? null : Math.max(0, run.capacity - enrolled.length)

  // Attendance rate across every marked roster cell for the run.
  const totalMarked = enrollments.reduce((s, e) => s + e.markedCount, 0)
  const totalAttended = enrollments.reduce((s, e) => s + e.attendedCount, 0)
  const attendanceRate = totalMarked > 0 ? Math.round((totalAttended / totalMarked) * 100) : null

  // Revenue estimate: full price per non-withdrawn enrolment (drop-ins excluded
  // from the headline — their per-session pricing is computed elsewhere).
  const billable = enrollments.filter(e => e.status !== 'WITHDRAWN' && e.type === 'FULL').length
  const revenue = run.priceCents != null ? run.priceCents * billable : null

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

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: enrollments.length > 0 ? enrollments.length : undefined },
  ]

  return (
    <>
      <PageHeader
        title={run.name}
        subtitle={run.scheduleNote ? `${run.scheduleNote} · ${seatsLabel}` : seatsLabel}
        back={{ href: '/classes', label: 'Classes' }}
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-6 max-w-xs">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.badge != null && (
                <span className={`min-w-4 h-4 px-1 text-[10px] font-semibold tabular-nums rounded-full flex items-center justify-center ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'details' ? (
        <>
          {/* Class controls */}
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
                <Detail label="Price" value={formatPrice(run.priceCents)} />
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

          {/* Sessions */}
          <Card>
            <CardBody className="py-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
                <CalendarDays className="h-4 w-4 text-slate-400" /> Sessions
                <span className="text-sm font-normal text-slate-500">({sessions.length})</span>
              </h2>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No sessions scheduled.</p>
              ) : (
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
              )}
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Capacity" value={run.capacity != null ? String(run.capacity) : '∞'} />
            <Stat label="Enrolled" value={String(enrolled.length)} />
            <Stat label="Waitlisted" value={String(waitlisted.length)} />
            <Stat label="Spots left" value={spotsLeft != null ? String(spotsLeft) : '∞'} />
            <Stat label="Attendance" value={attendanceRate != null ? `${attendanceRate}%` : '—'} />
            <Stat label="Revenue" value={revenue != null ? formatPrice(revenue) : '—'} />
          </div>

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

              {enrollments.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No one enrolled yet.</p>
              ) : (
                <>
                  {present.length > 0 && (
                    <EnrollTable title="Current roster" rows={present} onWithdraw={withdraw} withdrawable />
                  )}
                  {past.length > 0 && (
                    <div className="mt-5">
                      <EnrollTable title="Past clients" rows={past} onWithdraw={withdraw} withdrawable={false} />
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}

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

function EnrollTable({
  title,
  rows,
  onWithdraw,
  withdrawable,
}: {
  title: string
  rows: Enrollment[]
  onWithdraw: (id: string) => void
  withdrawable: boolean
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1 px-1">{title} ({rows.length})</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="font-medium py-2 px-1">Client</th>
              <th className="font-medium py-2 px-1">Dog</th>
              <th className="font-medium py-2 px-1">Status</th>
              <th className="font-medium py-2 px-1">Attendance</th>
              {withdrawable && <th className="font-medium py-2 px-1"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(e => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-1">
                  <Link href={`/clients/${e.clientId}`} className="flex items-center gap-2.5 group">
                    <ClientAvatar name={e.clientName} dogPhotoUrl={e.dogPhotoUrl} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900 group-hover:text-blue-600 truncate">{e.clientName}</span>
                      {(e.type === 'DROP_IN' || e.source === 'SELF_SERVE' || e.waitlistPosition != null) && (
                        <span className="block text-[11px] text-slate-400">
                          {e.waitlistPosition != null && `#${e.waitlistPosition} waitlist`}
                          {e.type === 'DROP_IN' && <span className="text-amber-600"> · drop-in</span>}
                          {e.source === 'SELF_SERVE' && ' · self-enrolled'}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="py-2.5 px-1 text-slate-600">{e.dogName ?? '—'}</td>
                <td className="py-2.5 px-1">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ENROLL_BADGE[e.status]}`}>
                    {e.status.toLowerCase()}
                  </span>
                </td>
                <td className="py-2.5 px-1 text-slate-600 tabular-nums">
                  {e.markedCount > 0 ? `${e.attendedCount} / ${e.markedCount}` : '—'}
                </td>
                {withdrawable && (
                  <td className="py-2.5 px-1 text-right">
                    <button
                      onClick={() => onWithdraw(e.id)}
                      className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                    >
                      {e.status === 'WAITLISTED' ? 'Remove' : 'Withdraw'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="py-3 px-4">
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </CardBody>
    </Card>
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
