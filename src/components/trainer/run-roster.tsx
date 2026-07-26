'use client'

// The parts of a ClassRun's detail screen that are genuinely the same whoever
// is looking at it: the roster table and the enrol flow. A group class and a
// one-off event are different things to a trainer — a course of sessions at one
// price versus a single occasion with named ticket types — and each owns its own
// screen (`/classes/[runId]` and `/events/[eventId]`). But underneath they are
// both a ClassRun with ClassEnrollments, so who's in it, what they owe and how
// you add someone must not drift between the two.
//
// What lives here: the enrolment types, the roster table (folded per client),
// the label/value rows the detail cards are built from, and the enrol modal
// (which is the only place ticket type + quantity are chosen).

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { ModalPortal } from '@/components/shared/modal-portal'
import { X, Loader2, Check, Send, FileText, AlertTriangle, Search, Minus, Plus, Trash2 } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'

export type EnrollStatus = 'ENROLLED' | 'WAITLISTED' | 'WITHDRAWN' | 'COMPLETED'

export type SessionRow = {
  id: string
  title: string
  scheduledAt: string
  sessionIndex: number | null
  status: string
}

/** One ticket type an event sells. Empty for every other kind of run. */
export type TicketTier = {
  id: string
  name: string
  priceCents: number | null
  capacity: number | null
  /** Places already taken on this ticket type (ENROLLED only). */
  sold: number
}

export type Enrollment = {
  id: string
  status: EnrollStatus
  type: 'FULL' | 'DROP_IN'
  /** Where this enrolment's invoice has got to. null = never raised one. */
  invoiceState: 'PAID' | 'SENT' | 'UNSENT' | 'CANCELLED' | null
  waitlistPosition: number | null
  source: string
  /** DROP_IN only: the session this booking is for. */
  dropInSessionId: string | null
  dropInSessionAt: string | null
  dropInSessionIndex: number | null
  clientId: string
  clientName: string
  dogName: string | null
  dogPhotoUrl: string | null
  attendedCount: number
  markedCount: number
  /** Events only: which ticket type they bought, and how many. */
  ticketTierId: string | null
  ticketName: string | null
  ticketPriceCents: number | null
  quantity: number
}

export type ClientOpt = { id: string; name: string; dogId: string | null; dogName: string | null }

const ENROLL_BADGE: Record<EnrollStatus, string> = {
  ENROLLED: 'bg-emerald-50 text-emerald-700',
  WAITLISTED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-blue-50 text-blue-700',
  WITHDRAWN: 'bg-slate-100 text-slate-500',
}

/** Two facts on one row, each keeping the label-left shape. */
export function DetailPair({
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

/** One fact about the run: label on the left, value beside it — and it never
 *  truncates the value. */
export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
      <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {/* Dates render in the viewer's locale/timezone, which differs from the
          server's UTC SSR — suppress the expected hydration text mismatch. */}
      <p className="min-w-0 flex-1 text-sm font-medium text-slate-800" suppressHydrationWarning>{value}</p>
    </div>
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
  /** "General × 2" — what they bought, when the run sells ticket types. */
  ticketLabel: string | null
}

/** Worst-first: one unpaid session is the thing a trainer needs to see, so it
 *  wins over the paid ones sitting beside it. null (no invoice at all) is the
 *  worst of the lot — there's nothing for the client to pay against. */
export function worstInvoiceState(states: Enrollment['invoiceState'][]): Enrollment['invoiceState'] {
  if (states.some(s => s == null)) return null
  if (states.some(s => s === 'UNSENT')) return 'UNSENT'
  if (states.some(s => s === 'SENT')) return 'SENT'
  if (states.some(s => s === 'PAID')) return 'PAID'
  return 'CANCELLED'
}

/** What one enrolment bought, as a label: "General × 2", or just "General". */
function ticketLabelFor(e: Enrollment): string | null {
  if (!e.ticketName) return e.quantity > 1 ? `× ${e.quantity}` : null
  return e.quantity > 1 ? `${e.ticketName} × ${e.quantity}` : e.ticketName
}

export function groupByClient(rows: Enrollment[]): ClientGroup[] {
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
        ticketLabel: ticketLabelFor(e),
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
    g.ticketLabel ??= ticketLabelFor(e)
    // An enrolled booking outranks a waitlisted one in the status badge —
    // "waitlisted" on someone who's confirmed for two sessions would be a lie.
    if (e.status === 'ENROLLED') g.status = 'ENROLLED'
  }
  for (const g of out.values()) {
    g.invoiceState = worstInvoiceState(rows.filter(r => g.ids.includes(r.id)).map(r => r.invoiceState))
  }
  return [...out.values()]
}

export function EnrollTable({
  title,
  rows,
  onWithdraw,
  withdrawable,
  runId,
  dropInClass,
  ticketed = false,
}: {
  /** Omitted for the main roster — the card heading already names it. */
  title?: string
  rows: Enrollment[]
  onWithdraw: (ids: string[]) => void
  withdrawable: boolean
  runId: string
  /** The class takes drop-ins, so a row's kind is worth spelling out. */
  dropInClass: boolean
  /** The run sells named ticket types — show which one each guest holds. */
  ticketed?: boolean
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
              {ticketed && <th className="font-medium py-2 px-1">Ticket</th>}
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
                {ticketed && <td className="py-2.5 px-1 text-slate-600">{g.ticketLabel ?? '—'}</td>}
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

export function EnrolModal({
  runId,
  clients,
  allowDropIn,
  sessions,
  bookedByClient,
  existing,
  tiers = [],
  onClose,
  onDone,
}: {
  runId: string
  clients: ClientOpt[]
  allowDropIn: boolean
  sessions: SessionRow[]
  bookedByClient: Map<string, Set<string>>
  existing: Set<string>
  /** Ticket types this run sells. Non-empty only for a one-off event. */
  tiers?: TicketTier[]
  onClose: () => void
  onDone: () => void
}) {
  const currency = useCurrency()
  const candidates = clients.filter(c => !existing.has(c.name))
  // Two steps: WHO, then WHAT. All of it on one panel outgrew the viewport
  // once a drop-in class listed its sessions — the Enrol button ended up below
  // the fold with nothing to scroll.
  const [step, setStep] = useState<1 | 2>(1)
  // Nobody is picked up front: a pre-selected first name is the wrong client
  // by default, and one stray Enter enrols them.
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')
  // Match on the client's name OR their dog's — trainers routinely remember
  // "Teddy's owner" rather than the owner's surname.
  const q = search.trim().toLowerCase()
  const visible = q
    ? candidates.filter(c =>
        c.name.toLowerCase().includes(q) || (c.dogName ?? '').toLowerCase().includes(q))
    : candidates
  const chosen = candidates.find(c => c.id === clientId) ?? null
  const [type, setType] = useState<'FULL' | 'DROP_IN'>('FULL')
  // Which sessions a drop-in is being booked into. A drop-in is per session,
  // so this is a multi-select — booking someone into three Saturdays is one
  // trip through this form, not three.
  const [sessionIds, setSessionIds] = useState<string[]>([])
  // Which ticket, and how many. An event that sells one type still asks, so the
  // enrolment records what was bought and the invoice quotes the right price.
  const [ticketTierId, setTicketTierId] = useState<string>(() => tiers[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const tier = tiers.find(t => t.id === ticketTierId) ?? null
  const ticketsLeft = tier?.capacity == null ? null : Math.max(0, tier.capacity - tier.sold)
  const upcoming = sessions.filter(s => s.status === 'UPCOMING' && new Date(s.scheduledAt).getTime() > Date.now())
  // What this client already holds. Shown as booked rather than left tickable
  // and refused on submit — the answer is already on screen.
  const alreadyBooked = bookedByClient.get(clientId) ?? new Set<string>()
  const bookable = upcoming.filter(s => !alreadyBooked.has(s.id))
  // Changing client changes what's already booked, so a tick left over from
  // the previous one could post a session this client can't take.
  useEffect(() => { setSessionIds([]) }, [clientId])
  // A sold-out ticket type shouldn't sit there with "2" in the box.
  useEffect(() => { setQuantity(1) }, [ticketTierId])
  const [notify, setNotify] = useState(true)
  // Ask them to pay now, or raise the invoice quietly and chase it later.
  const [sendInvoice, setSendInvoice] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Never two scrollbars: the panel scrolls, so the page behind it must not.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!clientId) {
      setError('Pick a client.')
      setStep(1)
      return
    }
    // Enter on step 1 must not enrol — it means "I've picked, move on".
    if (step === 1) {
      setStep(2)
      return
    }
    if (type === 'DROP_IN' && sessionIds.length === 0) {
      setError('Pick at least one session to drop into.')
      return
    }
    if (tiers.length > 0 && type === 'FULL' && !ticketTierId) {
      setError('Pick a ticket type.')
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
          ...(tiers.length > 0 && type === 'FULL' && { ticketTierId, quantity }),
          notify,
          sendInvoice,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not enrol that client.')
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
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      {/* Capped height with its own scroll, so the footer is always reachable
          however many sessions or ticket types the run has. */}
      <div className="relative z-50 flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-5">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Enrol a client</h2>
            {candidates.length > 0 && (
              <p className="text-[11px] text-slate-400">
                {step === 1 ? 'Step 1 of 2 · Who' : 'Step 2 of 2 · What they’re booked into'}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          {error && <Alert variant="error">{error}</Alert>}
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500">
              {clients.length === 0
                ? "You don't have any clients yet — add a client first, then enrol them here."
                : 'Every active client is already enrolled.'}
            </p>
          ) : step === 1 ? (
            <>
              {/* Type to narrow, click to choose. A native <select> can't show
                  a dog beside the owner or a tick on the chosen row, and at a
                  few hundred clients it's unscannable. */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search clients or dogs…"
                  aria-label="Search clients"
                  autoFocus
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {visible.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No client matches &ldquo;{search}&rdquo;.</p>
              ) : (
                <div className="no-scrollbar -mx-1 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {visible.map(c => {
                    const on = c.id === clientId
                    const held = bookedByClient.get(c.id)?.size ?? 0
                    return (
                      <button
                        key={c.id}
                        type="button"
                        // Choosing IS the step — no separate Next click for
                        // the common case of picking the person you searched.
                        onClick={() => { setClientId(c.id); setStep(2) }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{c.name}</span>
                          {c.dogName && <span className="block truncate text-[11px] text-slate-400">{c.dogName}</span>}
                        </span>
                        {held > 0 && (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            {held} booked
                          </span>
                        )}
                        {on && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Who this is for, and a way back to change it. */}
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{chosen?.name}</span>
                  {chosen?.dogName && <span className="block truncate text-[11px] text-slate-400">{chosen.dogName}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="shrink-0 text-[11px] font-semibold text-blue-600 hover:underline"
                >
                  Change
                </button>
              </div>

              {/* An event sells named tickets at their own prices. Which one and
                  how many is the whole question — and it's what gets invoiced,
                  so it can't be assumed to be "one, at the offering price". */}
              {tiers.length > 0 && type === 'FULL' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">Ticket type</label>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {tiers.map(t => {
                        const on = t.id === ticketTierId
                        const left = t.capacity == null ? null : Math.max(0, t.capacity - t.sold)
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTicketTierId(t.id)}
                            disabled={left === 0}
                            aria-pressed={on}
                            className={`flex w-full items-center gap-2.5 px-3 py-3 text-left first:rounded-t-xl last:rounded-b-xl disabled:opacity-50 ${
                              on ? 'bg-blue-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-800">{t.name}</span>
                              {left != null && (
                                <span className="block text-[11px] text-slate-400">
                                  {left === 0 ? 'Sold out' : `${left} left`}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-sm font-medium tabular-nums text-slate-700">
                              {formatMoney(t.priceCents ?? 0, currency)}
                            </span>
                            {on && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* A stepper, not a number field: this is thumbed on a phone
                      beside a trestle table, and 1–2 is the usual answer. */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">How many</label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label="One fewer"
                        onClick={() => setQuantity(n => Math.max(1, n - 1))}
                        disabled={quantity <= 1}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 disabled:opacity-40"
                      >
                        <Minus className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <span className="w-10 text-center text-lg font-semibold tabular-nums text-slate-900" aria-live="polite">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="One more"
                        onClick={() => setQuantity(n => Math.min(20, ticketsLeft == null ? n + 1 : Math.min(ticketsLeft, n + 1)))}
                        disabled={quantity >= 20 || (ticketsLeft != null && quantity >= ticketsLeft)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-700 disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      {tier && (
                        <span className="ml-auto min-w-0 text-right">
                          <span className="block text-[11px] text-slate-400">Total</span>
                          <span className="block text-sm font-semibold tabular-nums text-slate-900">
                            {formatMoney((tier.priceCents ?? 0) * quantity, currency)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

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
                    {/* Select all means all they can still take — the ones
                        they already hold aren't on offer. */}
                    {bookable.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSessionIds(sessionIds.length === bookable.length ? [] : bookable.map(s => s.id))}
                        className="text-[11px] font-semibold text-blue-600 hover:underline"
                      >
                        {sessionIds.length === bookable.length ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-slate-500">No sessions still to come in this class.</p>
                  ) : bookable.length === 0 ? (
                    <p className="text-sm text-slate-500">They&apos;re already booked into every session still to come.</p>
                  ) : (
                    <div className="no-scrollbar max-h-52 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                      {upcoming.map(s => {
                        const booked = alreadyBooked.has(s.id)
                        const on = sessionIds.includes(s.id)
                        return (
                          <label
                            key={s.id}
                            className={`flex items-center gap-2.5 px-3 py-2.5 ${
                              booked ? 'bg-slate-50 cursor-default' : on ? 'bg-blue-50 cursor-pointer' : 'hover:bg-slate-50 cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={booked || on}
                              disabled={booked}
                              onChange={() => setSessionIds(prev => on ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-default disabled:opacity-60"
                            />
                            <span className={`min-w-0 flex-1 text-sm ${booked ? 'text-slate-400' : 'text-slate-700'}`} suppressHydrationWarning>
                              {new Date(s.scheduledAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            {booked && (
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                Already booked
                              </span>
                            )}
                            <span className={`shrink-0 text-sm tabular-nums ${booked ? 'text-slate-400' : 'text-slate-500'}`} suppressHydrationWarning>
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
            </>
          )}
        </div>

        {/* Pinned: the action stays reachable no matter how long the session
            list runs. */}
        {candidates.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 p-4">
            {step === 2 ? (
              <>
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <div className="ml-auto">
                  <Button type="submit" loading={saving}>Enrol</Button>
                </div>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <div className="ml-auto">
                  <Button type="submit" disabled={!clientId}>Next</Button>
                </div>
              </>
            )}
          </div>
        )}
        </form>
      </div>
    </div>
    </ModalPortal>
  )
}

/** Shared delete control for a run's page header: confirm inline, then DELETE.
 *  Same two-step shape on both detail screens so the destructive action never
 *  behaves differently depending on which one you're standing on. */
export function DeleteRunButton({
  runId,
  label,
  confirmText,
  onDeleted,
  onError,
}: {
  runId: string
  label: string
  confirmText: string
  onDeleted: () => void
  onError: (message: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/class-runs/${runId}`, { method: 'DELETE' })
      if (res.ok) { onDeleted(); return }
      const body = await res.json().catch(() => null)
      onError(typeof body?.error === 'string' ? body.error : `Could not delete this ${label} — try again.`)
    } catch {
      onError(`Could not delete this ${label} — check your connection and try again.`)
    }
    setDeleting(false)
    setConfirming(false)
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        title={`Delete ${label}`}
        className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
      >
        <Trash2 className="h-4 w-4 text-rose-500" strokeWidth={1.75} />
        <span className="hidden sm:inline">Delete</span>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-600 hidden sm:inline">{confirmText}</span>
      <button
        onClick={() => setConfirming(false)}
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
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" strokeWidth={1.75} />}
        Yes, delete
      </button>
    </div>
  )
}
