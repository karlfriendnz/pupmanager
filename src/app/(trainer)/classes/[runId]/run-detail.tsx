'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { CardHeading } from '@/components/shared/card-heading'
import { Users, UserPlus, X, CalendarDays, ClipboardCheck, Pencil, Trash2, Loader2, Info, Check, Send, FileText, AlertTriangle, Search } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'

type Tab = 'details' | 'clients'
type RunStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
type EnrollStatus = 'ENROLLED' | 'WAITLISTED' | 'WITHDRAWN' | 'COMPLETED'
type AssignedTrainer = { membershipId: string; name: string; title: string | null }
type Run = {
  id: string
  /** The offering behind this class — where the full-page editor lives. */
  packageId: string
  name: string
  scheduleNote: string | null
  location: string | null
  description: string | null
  startDate: string
  status: RunStatus
  capacity: number | null
  packageName: string
  allowDropIn: boolean
  allowWaitlist: boolean
  priceCents: number | null
  durationMins: number
  // "Gap before the next session" — turnaround time blocked after each class.
  bufferMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  weeksBetween: number
  sessionCount: number
  defaultSessionFormId: string | null
  hasAttendance: boolean
  imageUrl: string | null
  requirePayment: boolean | null
  assignedMembershipIds: string[]
  assignedTrainers: AssignedTrainer[]
}
type SessionRow = { id: string; title: string; scheduledAt: string; sessionIndex: number | null; status: string }
type Enrollment = {
  id: string
  status: EnrollStatus
  type: 'FULL' | 'DROP_IN'
  /** Where this enrolment's invoice has got to. null = never raised one. */
  invoiceState: 'PAID' | 'SENT' | 'UNSENT' | 'CANCELLED' | null
  waitlistPosition: number | null
  source: string
  /** DROP_IN only: the session this booking is for. */
  dropInSessionAt: string | null
  dropInSessionIndex: number | null
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
  const currency = useCurrency()
  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)
  const [tab, setTab] = useState<Tab>('details')
  const [clientTab, setClientTab] = useState<'current' | 'past'>('current')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/class-runs/${run.id}`, { method: 'DELETE' })
      if (res.ok) {
        // refresh() first so the /classes list re-renders without the run —
        // pushing alone can serve the cached (stale) server render.
        router.refresh()
        router.push('/classes')
        return
      }
      const body = await res.json().catch(() => null)
      const msg = typeof body?.error === 'string' ? body.error : null
      setError(msg ?? 'Could not delete this class — try again.')
    } catch {
      setError('Could not delete this class — check your connection and try again.')
    }
    setDeleting(false)
    setConfirmingDelete(false)
  }

  const enrolled = enrollments.filter(e => e.status === 'ENROLLED')
  const waitlisted = enrollments.filter(e => e.status === 'WAITLISTED')
  const present = enrollments.filter(e => e.status === 'ENROLLED' || e.status === 'WAITLISTED')
  const past = enrollments.filter(e => e.status === 'WITHDRAWN' || e.status === 'COMPLETED')
  // On a drop-in class a row is a BOOKING, not a person — the same client can
  // hold several — so counting rows as "5 enrolled" reads as five people and
  // makes the repeated names look like duplicates. Capacity is per session
  // there too, so a "5 / 8" against the whole run would be wrong as well.
  const dropInPeople = new Set(enrolled.map(e => e.clientId)).size
  const seatsLabel = run.allowDropIn
    ? `${dropInPeople} client${dropInPeople === 1 ? '' : 's'} · ${enrolled.length} booking${enrolled.length === 1 ? '' : 's'}`
    : run.capacity == null
      ? `${enrolled.length} enrolled`
      : `${enrolled.length} / ${run.capacity}`

  // Revenue estimate: full price per non-withdrawn enrolment (drop-ins excluded
  // from the headline — their per-session pricing is computed elsewhere).
  const billable = enrollments.filter(e => e.status !== 'WITHDRAWN' && e.type === 'FULL').length
  const revenue = run.priceCents != null ? run.priceCents * billable : null


  // Takes a list: a drop-in client is one row on the roster but can hold
  // several bookings, and withdrawing them is one action, one refresh.
  async function withdraw(enrollmentIds: string[]) {
    setError(null)
    const results = await Promise.all(
      enrollmentIds.map(id =>
        fetch(`/api/class-runs/${run.id}/enrollments/${id}`, { method: 'DELETE' })),
    )
    if (results.some(r => !r.ok)) setError('Could not withdraw that enrolment.')
    router.refresh()
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: enrollments.length > 0 ? enrollments.length : undefined },
  ]

  return (
    <>
      <PageHeader
        title={run.name}
        back={{ href: '/classes', label: 'Classes' }}
        // Delete / Edit belong with the other page-level controls in the top
        // bar, not floating above the content.
        actions={
          <div className="flex items-center gap-2">
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                title="Delete class"
                className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
              >
                <Trash2 className="h-4 w-4 text-rose-500" />
                <span className="hidden sm:inline">Delete</span>
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
            {/* The whole class is edited on one full page — the same form, in
                the same order, as the wizard that created it. */}
            <Link href={`/packages/${run.packageId}/edit`}>
              <Button variant="secondary">
                <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Edit</span>
              </Button>
            </Link>
          </div>
        }
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. */}
      <div className="p-4 md:p-8 w-full">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Tabs are phone-only — a wide screen shows both columns at once, so
          switching between them would be switching between two things already
          on screen. Delete/Edit live in the top control bar. */}
      <div className="flex flex-wrap items-center gap-2 mb-6 lg:hidden">
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl max-w-xs">
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
      </div>

      {/* Two columns on a wide screen: the class on the left (what it is, then
          its sessions), the people on the right. The tabs still switch on a
          phone, where there's only room for one at a time. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:items-start gap-5">

      <div className={`flex flex-col gap-5 ${tab === 'details' ? '' : 'hidden lg:flex'}`}>

          {run.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={run.imageUrl}
              alt={run.name}
              className="w-full h-40 sm:h-52 object-cover rounded-2xl border border-slate-200"
            />
          )}

          {/* Class details */}
          <Card>
            <CardBody className="py-5">
              <CardHeading icon={<Info className="h-4 w-4 text-slate-400" />}>Details</CardHeading>
              <div className="divide-y divide-slate-100">
                {/* Read-only here, like every other fact on this card. It's
                    changed on the edit page, with the rest of the class. */}
                <Detail label="Status" value={run.status.charAt(0) + run.status.slice(1).toLowerCase()} />
                <Detail label="Schedule" value={run.scheduleNote || 'Weekly'} />
                <Detail label="Starts" value={new Date(run.startDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
                <Detail label="Length" value={`${run.durationMins} min`} />
                <Detail label="Format" value={run.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
                <Detail
                  label="Waitlist"
                  value={run.allowWaitlist
                    ? (waitlisted.length > 0 ? `Enabled, ${waitlisted.length}` : 'Enabled')
                    : 'Off'}
                />
                {run.allowDropIn && <Detail label="Drop-ins" value="Allowed" />}
                {/* Price and revenue read together — what one seat costs, and
                    what the class has sold — so they share a row. */}
                <DetailPair
                  label="Price" value={formatPrice(run.priceCents)}
                  label2="Revenue" value2={revenue != null ? formatPrice(revenue) : '—'}
                />
                {run.location && <Detail label="Location" value={run.location} />}
              </div>
              {/* The description is what clients are sent when they're booked
                  in, so it's worth seeing here rather than only in the edit
                  form — it's the thing you check before enrolling someone. */}
              {run.description && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">About this class</p>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{run.description}</p>
                </div>
              )}
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
            </CardBody>
          </Card>

          {/* Sessions */}
          <Card>
            <CardBody className="py-5">
              <CardHeading icon={<CalendarDays className="h-4 w-4 text-slate-400" />} count={sessions.length}>
                Sessions
              </CardHeading>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No sessions scheduled.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sessions.map(s => (
                    <li key={s.id}>
                      {/* The whole row is the link — the "Open" button was a
                          small target for something the entire row means. */}
                      <Link
                        href={`/classes/${run.id}/sessions/${s.id}`}
                        className="flex items-center gap-4 rounded-lg py-2.5 px-2 -mx-2 hover:bg-slate-50"
                      >
                        <p className="w-24 shrink-0 text-sm font-medium text-slate-900">Session {s.sessionIndex ?? '—'}</p>
                        <p className="min-w-0 flex-1 text-sm text-slate-600" suppressHydrationWarning>
                          {new Date(s.scheduledAt).toLocaleDateString([], { dateStyle: 'medium' })}
                        </p>
                        {/* Explicit hour12 — the browser locale renders 19:00
                            here, and trainers read their day in am/pm. */}
                        <p className="w-24 shrink-0 text-sm tabular-nums text-slate-600" suppressHydrationWarning>
                          {new Date(s.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </p>
                        <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-medium text-slate-600">
                          <ClipboardCheck className="h-4 w-4" /> Open
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
      </div>

      <div className={`flex flex-col gap-5 ${tab === 'clients' ? '' : 'hidden lg:flex'}`}>
          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Users className="h-4 w-4 text-slate-400" />}
                note={seatsLabel}
                action={
                  <Button variant="secondary" onClick={() => setAdding(true)}>
                    <UserPlus className="h-4 w-4" /> Enrol client
                  </Button>
                }
              >
                Clients
              </CardHeading>

              {enrollments.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No one enrolled yet.</p>
              ) : (
                <>
                  {/* Current / past as tabs rather than two stacked tables —
                      a long history of withdrawals shouldn't push who's
                      actually in the class off the bottom. */}
                  {/* Track padding 6px with a 10px pill inside a 16px track —
                      at 4px the active pill's shadow closes the gap and it
                      reads as bulging out of the track. */}
                  <div className="mb-3 inline-flex gap-1 rounded-2xl bg-slate-100 p-1.5">
                    {([
                      { id: 'current' as const, label: 'Current', count: present.length },
                      { id: 'past' as const, label: 'Past', count: past.length },
                    ]).map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setClientTab(t.id)}
                        aria-pressed={clientTab === t.id}
                        className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-all ${
                          clientTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {t.label}
                        <span className={`min-w-4 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                          clientTab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {t.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {clientTab === 'current' ? (
                    present.length > 0
                      ? <EnrollTable rows={present} onWithdraw={withdraw} withdrawable runId={run.id} dropInClass={run.allowDropIn} />
                      : <p className="text-sm text-slate-500 py-4 text-center">No one currently enrolled.</p>
                  ) : (
                    past.length > 0
                      ? <EnrollTable rows={past} onWithdraw={withdraw} withdrawable={false} runId={run.id} dropInClass={run.allowDropIn} />
                      : <p className="text-sm text-slate-500 py-4 text-center">No past clients.</p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
      </div>

      </div>

      {adding && (
        <EnrolModal
          runId={run.id}
          clients={clients}
          allowDropIn={run.allowDropIn}
          sessions={sessions}
          // Only a FULL enrolment takes someone out of the running — they're
          // already in every session. Someone with drop-ins booked can still
          // be added to more, so they stay pickable.
          existing={new Set(
            enrollments.filter(e => e.status !== 'WITHDRAWN' && e.type === 'FULL').map(e => e.clientName),
          )}
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

/** One roster row per client+dog, folding their bookings together. */
type ClientGroup = {
  key: string
  ids: string[]
  uninvoicedIds: string[]
  clientId: string
  clientName: string
  dogName: string | null
  dogPhotoUrl: string | null
  status: EnrollStatus
  waitlistPosition: number | null
  selfServe: boolean
  anyDropIn: boolean
  /** Bookings still to come — the number that matters on a drop-in class. */
  upcomingCount: number
  attendedCount: number
  markedCount: number
  invoiceState: Enrollment['invoiceState']
}

/** Worst-first: one unpaid session is the thing a trainer needs to see, so it
 *  wins over the paid ones sitting beside it. null (no invoice at all) is the
 *  worst of the lot — there's nothing for the client to pay against. */
function worstInvoiceState(states: Enrollment['invoiceState'][]): Enrollment['invoiceState'] {
  if (states.some(s => s == null)) return null
  if (states.some(s => s === 'UNSENT')) return 'UNSENT'
  if (states.some(s => s === 'SENT')) return 'SENT'
  if (states.some(s => s === 'PAID')) return 'PAID'
  return 'CANCELLED'
}

function groupByClient(rows: Enrollment[]): ClientGroup[] {
  const now = Date.now()
  const out = new Map<string, ClientGroup>()
  for (const e of rows) {
    // Keyed on the dog too: the same owner bringing two dogs is two enrolments
    // and genuinely two lines on the roster.
    const key = `${e.clientId}|${e.dogName ?? ''}`
    const g = out.get(key)
    const isUpcoming = e.dropInSessionAt != null && new Date(e.dropInSessionAt).getTime() > now
    if (!g) {
      out.set(key, {
        key,
        ids: [e.id],
        uninvoicedIds: e.invoiceState == null ? [e.id] : [],
        clientId: e.clientId,
        clientName: e.clientName,
        dogName: e.dogName,
        dogPhotoUrl: e.dogPhotoUrl,
        status: e.status,
        waitlistPosition: e.waitlistPosition,
        selfServe: e.source === 'SELF_SERVE',
        anyDropIn: e.type === 'DROP_IN',
        upcomingCount: isUpcoming ? 1 : 0,
        attendedCount: e.attendedCount,
        markedCount: e.markedCount,
        invoiceState: e.invoiceState,
      })
      continue
    }
    g.ids.push(e.id)
    if (e.invoiceState == null) g.uninvoicedIds.push(e.id)
    g.selfServe ||= e.source === 'SELF_SERVE'
    g.anyDropIn ||= e.type === 'DROP_IN'
    if (isUpcoming) g.upcomingCount++
    g.attendedCount += e.attendedCount
    g.markedCount += e.markedCount
    g.waitlistPosition ??= e.waitlistPosition
    // An enrolled booking outranks a waitlisted one in the status badge —
    // "waitlisted" on someone who's confirmed for two sessions would be a lie.
    if (e.status === 'ENROLLED') g.status = 'ENROLLED'
  }
  for (const g of out.values()) {
    g.invoiceState = worstInvoiceState(rows.filter(r => g.ids.includes(r.id)).map(r => r.invoiceState))
  }
  return [...out.values()]
}

function EnrollTable({
  title,
  rows,
  onWithdraw,
  withdrawable,
  runId,
  dropInClass,
}: {
  /** Omitted for the main roster — the card heading already names it. */
  title?: string
  rows: Enrollment[]
  onWithdraw: (ids: string[]) => void
  withdrawable: boolean
  runId: string
  /** The class takes drop-ins, so a row's kind is worth spelling out. */
  dropInClass: boolean
}) {
  const router = useRouter()
  // A client is ONE row, however many bookings they hold. A drop-in client with
  // three Saturdays booked was three near-identical rows, which read as the
  // roster having duplicated them.
  const groups = groupByClient(rows)
  // One-click repair for a row showing "No invoice" — enrolments made before
  // class invoicing existed have nothing behind them, and hand-building one in
  // Finances is a slog. The endpoint is idempotent, so a double-click is safe.
  const [invoicingKey, setInvoicingKey] = useState<string | null>(null)
  async function createInvoices(key: string, enrollmentIds: string[]) {
    if (invoicingKey || enrollmentIds.length === 0) return
    setInvoicingKey(key)
    try {
      const results = await Promise.all(enrollmentIds.map(id =>
        fetch(`/api/class-runs/${runId}/enrollments/${id}/invoice`, { method: 'POST' })))
      const bad = results.find(r => !r.ok)
      if (bad) {
        const body = await bad.json().catch(() => null) as { error?: unknown } | null
        alert(typeof body?.error === 'string' ? body.error : 'Could not create the invoice.')
        return
      }
      router.refresh()
    } finally {
      setInvoicingKey(null)
    }
  }

  return (
    <div>
      {title && <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1 px-1">{title} ({groups.length})</p>}
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
            {groups.map(g => (
              <tr key={g.key} className="hover:bg-slate-50">
                <td className="py-2.5 px-1">
                  <Link href={`/clients/${g.clientId}`} className="flex items-center gap-2.5 group">
                    <ClientAvatar name={g.clientName} dogPhotoUrl={g.dogPhotoUrl} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900 group-hover:text-blue-600 truncate">{g.clientName}</span>
                      {(g.waitlistPosition != null || g.selfServe || (dropInClass && !g.anyDropIn)) && (
                        <span className="block text-[11px] text-slate-400">
                          {g.waitlistPosition != null && `#${g.waitlistPosition} waitlist`}
                          {/* A full-run enrolment on a class that takes
                              drop-ins is the exception worth naming. */}
                          {dropInClass && !g.anyDropIn && <span className="text-slate-500">Full run</span>}
                          {g.selfServe && ' · self-enrolled'}
                        </span>
                      )}
                      {/* Billing state at a glance — the roster is where a
                          trainer notices someone hasn't been invoiced, not the
                          finances tab. Withdrawn rows have nothing to bill.
                          Across several bookings it's the worst state that
                          matters: one unpaid session is the thing to chase. */}
                      {g.status !== 'WITHDRAWN' && (
                        <span className="block mt-0.5">
                          {g.invoiceState === 'PAID' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                              <Check className="h-3 w-3" /> Paid
                            </span>
                          ) : g.invoiceState === 'SENT' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600">
                              <Send className="h-3 w-3" /> Invoice sent
                            </span>
                          ) : g.invoiceState === 'UNSENT' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                              <FileText className="h-3 w-3" /> Invoice not sent
                            </span>
                          ) : g.invoiceState === 'CANCELLED' ? (
                            <span className="text-[11px] font-medium text-slate-400">Invoice cancelled</span>
                          ) : (
                            // The repair: enrolments made before class
                            // invoicing existed have nothing behind them, and
                            // building one by hand in Finances is a slog.
                            <span className="inline-flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
                                <AlertTriangle className="h-3 w-3" /> No invoice
                              </span>
                              <button
                                type="button"
                                onClick={ev => { ev.preventDefault(); ev.stopPropagation(); createInvoices(g.key, g.uninvoicedIds) }}
                                disabled={invoicingKey === g.key}
                                className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-50"
                              >
                                {invoicingKey === g.key ? 'Creating…' : 'Create'}
                              </button>
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="py-2.5 px-1 text-slate-600">{g.dogName ?? '—'}</td>
                <td className="py-2.5 px-1">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ENROLL_BADGE[g.status]}`}>
                    {g.status.toLowerCase()}
                  </span>
                </td>
                {/* On a drop-in class the useful number isn't attendance yet —
                    it's how many sessions they're booked into from here. */}
                <td className="py-2.5 px-1 text-slate-600 tabular-nums">
                  {g.upcomingCount > 0
                    ? `${g.upcomingCount} upcoming`
                    : g.markedCount > 0
                      ? `${g.attendedCount} / ${g.markedCount}`
                      : '—'}
                </td>
                {withdrawable && (
                  <td className="py-2.5 px-1 text-right">
                    <button
                      onClick={() => onWithdraw(g.ids)}
                      className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
                    >
                      {g.status === 'WAITLISTED' ? 'Remove' : g.ids.length > 1 ? `Withdraw all (${g.ids.length})` : 'Withdraw'}
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

/** Two facts on one row, each keeping the label-left shape. */
function DetailPair({
  label, value, label2, value2,
}: { label: string; value: string; label2: string; value2: string }) {
  return (
    <div className="flex flex-col gap-2.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <div className="flex flex-1 items-baseline gap-4">
        <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{value}</p>
      </div>
      <div className="flex flex-1 items-baseline gap-4">
        <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:w-auto">{label2}</p>
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{value2}</p>
      </div>
    </div>
  )
}

/** One fact about the class: label on the left, value beside it — the same
 *  shape as the session rows below, and it never truncates the value. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
      <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {/* Dates render in the viewer's locale/timezone, which differs from the
          server's UTC SSR — suppress the expected hydration text mismatch. */}
      <p className="min-w-0 flex-1 text-sm font-medium text-slate-800" suppressHydrationWarning>{value}</p>
    </div>
  )
}

function EnrolModal({
  runId,
  clients,
  allowDropIn,
  sessions,
  existing,
  onClose,
  onDone,
}: {
  runId: string
  clients: ClientOpt[]
  allowDropIn: boolean
  sessions: SessionRow[]
  existing: Set<string>
  onClose: () => void
  onDone: () => void
}) {
  const candidates = clients.filter(c => !existing.has(c.name))
  const [clientId, setClientId] = useState(candidates[0]?.id ?? '')
  const [search, setSearch] = useState('')
  // Match on the client's name OR their dog's — trainers routinely remember
  // "Teddy's owner" rather than the owner's surname.
  const q = search.trim().toLowerCase()
  const visible = q
    ? candidates.filter(c =>
        c.name.toLowerCase().includes(q) || (c.dogName ?? '').toLowerCase().includes(q))
    : candidates
  // Keep the selection valid as the list narrows, so Enrol can't submit
  // someone who's been filtered away.
  useEffect(() => {
    if (visible.length > 0 && !visible.some(c => c.id === clientId)) setClientId(visible[0].id)
  }, [visible, clientId])
  const [type, setType] = useState<'FULL' | 'DROP_IN'>('FULL')
  // Which sessions a drop-in is being booked into. A drop-in is per session,
  // so this is a multi-select — booking someone into three Saturdays is one
  // trip through this form, not three.
  const [sessionIds, setSessionIds] = useState<string[]>([])
  const upcoming = sessions.filter(s => s.status === 'UPCOMING' && new Date(s.scheduledAt).getTime() > Date.now())
  const [notify, setNotify] = useState(true)
  // Ask them to pay now, or raise the invoice quietly and chase it later.
  const [sendInvoice, setSendInvoice] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!clientId) {
      setError('Pick a client.')
      return
    }
    if (type === 'DROP_IN' && sessionIds.length === 0) {
      setError('Pick at least one session to drop into.')
      return
    }
    const c = clients.find(x => x.id === clientId)
    setSaving(true)
    try {
      const res = await fetch(`/api/class-runs/${runId}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          dogId: c?.dogId ?? null,
          type,
          ...(type === 'DROP_IN' && { sessionIds }),
          notify,
          sendInvoice,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not enrol that client.')
        return
      }
      // Some of the chosen sessions can be full while others go through —
      // say which, rather than closing as if it all worked.
      const failed = (body.results ?? []).filter((r: { error?: string }) => r.error)
      if (failed.length > 0) {
        const names = failed
          .map((r: { sessionId: string | null }) => upcoming.find(s => s.id === r.sessionId))
          .filter(Boolean)
          .map((s: SessionRow) => new Date(s.scheduledAt).toLocaleDateString([], { dateStyle: 'medium' }))
        setError(`Booked ${body.booked} of ${sessionIds.length}. Couldn’t book ${names.join(', ')} — ${failed[0].error}`)
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
                {/* A bare <select> is unusable once a trainer has a few hundred
                    clients — you can't scan for a name. Filter first, then
                    pick. The box only appears when there's enough to warrant
                    it. */}
                {candidates.length > 8 && (
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search clients or dogs…"
                      aria-label="Search clients"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                <select
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  size={visible.length > 8 ? 8 : undefined}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {visible.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.dogName ? ` · ${c.dogName}` : ''}
                    </option>
                  ))}
                </select>
                {visible.length === 0 && (
                  <p className="text-[11px] text-slate-400 mt-1">No client matches &ldquo;{search}&rdquo;.</p>
                )}
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

              {/* A drop-in is per session, so which ones is the whole question.
                  Tick as many as they're coming to — each is booked and billed
                  on its own. */}
              {allowDropIn && type === 'DROP_IN' && (
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className="text-sm font-medium text-slate-700">Which sessions?</label>
                    {upcoming.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSessionIds(sessionIds.length === upcoming.length ? [] : upcoming.map(s => s.id))}
                        className="text-[11px] font-semibold text-blue-600 hover:underline"
                      >
                        {sessionIds.length === upcoming.length ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-slate-500">No sessions still to come in this class.</p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                      {upcoming.map(s => {
                        const on = sessionIds.includes(s.id)
                        return (
                          <label
                            key={s.id}
                            className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setSessionIds(prev => on ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            <span className="min-w-0 flex-1 text-sm text-slate-700" suppressHydrationWarning>
                              {new Date(s.scheduledAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            <span className="shrink-0 text-sm tabular-nums text-slate-500" suppressHydrationWarning>
                              {new Date(s.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {sessionIds.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {sessionIds.length} session{sessionIds.length === 1 ? '' : 's'} — billed per session.
                    </p>
                  )}
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
              {/* The invoice is raised either way — this decides whether the
                  client is asked to pay now (Pay now button in their enrolment
                  email) or it sits as a draft for the trainer to send later. */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendInvoice}
                  onChange={e => setSendInvoice(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm text-slate-700">
                  Send the invoice
                  <span className="block text-[11px] text-slate-400">
                    Adds a Pay now button to their email. Untick to raise it quietly and chase it later.
                  </span>
                </span>
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
