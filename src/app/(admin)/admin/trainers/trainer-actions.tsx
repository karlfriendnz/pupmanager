'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, X, Check, LogIn, Ban, RotateCcw, AlertTriangle, Mail, Loader2 } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'

// Shape returned by GET /api/admin/trainers/[trainerId]/onboarding-emails
type EmailReport = {
  enrolled: boolean
  enrollmentNote: string | null
  timezone: string
  sent: Array<{ key: string; subject: string; senderKey: string; sentAt: string }>
  upcoming: Array<{
    key: string
    subject: string
    senderKey: string
    status: 'eligible' | 'scheduled' | 'waiting' | 'skip'
    dueAt: string | null
    note: string
  }>
}

type Trainer = {
  id: string
  name: string | null
  email: string
  businessName: string | null
  subscriptionPlanName: string | null
  subscriptionStatus: string | null
  trialEndsAt: Date | string | null
  isInternal: boolean
  // ISO 3166-1 alpha-2 country of signup (from IP geo), or null. Rendered as a
  // flag + code chip.
  signupCountry: string | null
  clientCount: number
  // >0 when the trainer still has first-run "Sample" preview clients they
  // haven't cleared — surfaced as a badge so admins can spot accounts that
  // haven't started entering real data yet.
  sampleClientCount: number
  onboardingCompleted: number
  onboardingTotal: number
  onboardingEmails: number
  gracePeriodUntil: Date | string | null
  // Seat allowance — owner + invited members must fit within this. Set from the
  // edit panel regardless of subscription (handy for trialing accounts).
  seatCount: number
  deactivatedAt: Date | string | null
  createdAt: Date
  // Most recent successful sign-in, or null if they've never logged in since we
  // started tracking it. Rendered as a relative "Last seen" stamp.
  lastLoginAt: Date | string | null
}

// ISO 3166-1 alpha-2 → flag emoji (regional indicator pair). Null for anything
// that isn't a clean 2-letter code.
function flagEmoji(iso: string | null): string | null {
  if (!iso || iso.length !== 2 || !/^[A-Za-z]{2}$/.test(iso)) return null
  const cc = iso.toUpperCase()
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// Compact join stamp in NZT: "DD MMM - H:MM AM/PM", e.g. "14 Jun - 4:37 PM".
function joinedLabel(d: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(d))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  // Normalise the meridiem ("pm" / "p.m." → "PM") for a clean, consistent label.
  const ap = get('dayPeriod').replace(/\./g, '').toUpperCase()
  return `${get('day')} ${get('month')} - ${get('hour')}:${get('minute')} ${ap}`
}

// Relative "last seen" label, e.g. "5m ago", "3h ago", "2d ago", "Jun 14".
// Older than a week falls back to an absolute short date.
function lastSeenLabel(d: Date | string | null): string {
  if (!d) return 'Never'
  const then = new Date(d).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short',
  }).format(new Date(d))
}

export function TrainerRow({ trainer }: { trainer: Trainer }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [showHardDelete, setShowHardDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Expandable onboarding/trial email report — lazy-loaded on first open.
  const [showEmails, setShowEmails] = useState(false)
  const [report, setReport] = useState<EmailReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  async function toggleEmails() {
    const next = !showEmails
    setShowEmails(next)
    if (next && !report && !loadingReport) {
      setLoadingReport(true)
      setReportError(null)
      try {
        const res = await fetch(`/api/admin/trainers/${trainer.id}/onboarding-emails`)
        if (!res.ok) throw new Error()
        setReport(await res.json())
      } catch {
        setReportError('Could not load the email report.')
      } finally {
        setLoadingReport(false)
      }
    }
  }

  const isActive = !trainer.deactivatedAt

  const [name, setName] = useState(trainer.name ?? '')
  const [email, setEmail] = useState(trainer.email)
  const [businessName, setBusinessName] = useState(trainer.businessName ?? '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, businessName }),
    })
    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      const data = await res.json()
      setError(typeof data.error === 'string' ? data.error : 'Failed to save')
    }
    setSaving(false)
  }

  // Soft delete: deactivate (active=false) or reinstate (active=true). Never
  // removes data — just toggles the sign-in block.
  async function setActive(active: boolean) {
    setTogglingActive(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    if (res.ok) {
      router.refresh()
      setConfirmDeactivate(false)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Failed to update account')
    }
    setTogglingActive(false)
  }

  // Hard delete: permanent removal. Only reachable from the typed-confirmation
  // modal, and the server also requires the account to be deactivated first.
  async function handleHardDelete() {
    setDeleting(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      setShowHardDelete(false)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Failed to delete trainer')
      setShowHardDelete(false)
    }
    setDeleting(false)
  }

  // Grant (days > 0) or clear (days === null) an access grace period.
  const [savingGrace, setSavingGrace] = useState(false)
  async function setGrace(days: number | null) {
    setSavingGrace(true)
    setError(null)
    const gracePeriodUntil =
      days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gracePeriodUntil }),
    })
    if (res.ok) router.refresh()
    else setError('Failed to update grace period')
    setSavingGrace(false)
  }

  // Apply a fresh N-day trial from today (sets trialEndsAt + flips to TRIALING).
  const [savingTrial, setSavingTrial] = useState(false)
  async function applyTrial(days: number) {
    setSavingTrial(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applyTrialDays: days }),
    })
    if (res.ok) router.refresh()
    else setError('Failed to apply trial')
    setSavingTrial(false)
  }

  // Set the trainer's seat allowance directly (independent of Stripe).
  const [savingSeats, setSavingSeats] = useState(false)
  async function setSeats(seatCount: number) {
    setSavingSeats(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seatCount }),
    })
    if (res.ok) router.refresh()
    else setError('Failed to update seats')
    setSavingSeats(false)
  }

  // Mark/unmark this as a PupManager-owned (internal/test) account.
  const [savingInternal, setSavingInternal] = useState(false)
  async function toggleInternal() {
    setSavingInternal(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isInternal: !trainer.isInternal }),
    })
    if (res.ok) router.refresh()
    else setError('Failed to update account flag')
    setSavingInternal(false)
  }

  const graceUntil = trainer.gracePeriodUntil ? new Date(trainer.gracePeriodUntil) : null
  const graceActive = !!graceUntil && graceUntil.getTime() > Date.now()
  const trialEnds = trainer.trialEndsAt ? new Date(trainer.trialEndsAt) : null

  if (editing) {
    return (
      <tr className="border-b border-slate-700/50 bg-slate-700/40">
        <td colSpan={10} className="px-4 py-4">
          {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Email</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Business name</label>
              <input
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 h-9 rounded-lg disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setError(null) }}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 h-9 rounded-lg border border-slate-600"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>

          {/* Trial period — apply a fresh trial from today */}
          <div className="mt-4 pt-3 border-t border-slate-600/50">
            <p className="text-xs text-slate-400 mb-2">
              Trial
              {trialEnds
                ? <span className="text-slate-300"> · ends {formatDate(trialEnds)}</span>
                : <span className="text-slate-500"> · none</span>}
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              {[30, 60, 100].map(d => (
                <button
                  key={d}
                  onClick={() => applyTrial(d)}
                  disabled={savingTrial}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50"
                >
                  {d}-day trial
                </button>
              ))}
            </div>
          </div>

          {/* Trainer seats — owner + invited members must fit within this */}
          <div className="mt-4 pt-3 border-t border-slate-600/50">
            <p className="text-xs text-slate-400 mb-2">
              Trainer seats
              <span className="text-slate-300"> · currently {trainer.seatCount} seat{trainer.seatCount === 1 ? '' : 's'}</span>
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              {[1, 2, 3, 5, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setSeats(n)}
                  disabled={savingSeats || trainer.seatCount === n}
                  className={`text-xs px-3 h-8 rounded-lg disabled:opacity-50 ${
                    trainer.seatCount === n
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  }`}
                >
                  {n} seat{n === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          </div>

          {/* Access grace period — overrides the paywall regardless of plan/trial */}
          <div className="mt-4 pt-3 border-t border-slate-600/50">
            <p className="text-xs text-slate-400 mb-2">
              Access grace period
              {graceActive
                ? <span className="text-green-300"> · active until {formatDate(graceUntil!)}</span>
                : <span className="text-slate-500"> · none</span>}
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setGrace(d)}
                  disabled={savingGrace}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50"
                >
                  +{d} days
                </button>
              ))}
              {graceActive && (
                <button
                  onClick={() => setGrace(null)}
                  disabled={savingGrace}
                  className="text-xs text-rose-300 hover:text-rose-200 px-3 h-8 rounded-lg border border-rose-500/40 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Internal / PupManager-owned account flag */}
          <div className="mt-4 pt-3 border-t border-slate-600/50">
            <p className="text-xs text-slate-400 mb-2">
              Account type
              {trainer.isInternal
                ? <span className="text-purple-300"> · PupManager (internal/test)</span>
                : <span className="text-slate-500"> · real customer</span>}
            </p>
            <button
              onClick={toggleInternal}
              disabled={savingInternal}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50"
            >
              {trainer.isInternal ? 'Unmark as ours' : 'Mark as ours (internal)'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <>
    <tr className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${isActive ? '' : 'opacity-60'}`}>
      <td className="px-4 py-3 text-white">
        <span className="group relative inline-flex items-center gap-1.5">
          <span className="cursor-default border-b border-dotted border-slate-500/60">
            {trainer.name?.trim() || '—'}
          </span>
          {trainer.isInternal && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-300">
              Ours
            </span>
          )}
          {!isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-500/40">
              Inactive
            </span>
          )}
          {/* Instant email tooltip on hover (native title is unreliable). */}
          <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 shadow-lg ring-1 ring-slate-700 group-hover:block">
            {trainer.email}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 text-slate-300">{trainer.businessName?.trim() || '—'}</td>
      <td className="px-4 py-3">
        {trainer.signupCountry ? (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-slate-300 tabular-nums"
            title={`Signed up in ${trainer.signupCountry}`}
          >
            <span aria-hidden className="text-base leading-none">{flagEmoji(trainer.signupCountry)}</span>
            {trainer.signupCountry}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          trainer.subscriptionStatus === 'ACTIVE' ? 'bg-green-900 text-green-300' :
          trainer.subscriptionStatus === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
          'bg-slate-700 text-slate-400'
        }`}>
          {trainer.subscriptionStatus === 'TRIALING'
            ? 'Trial'
            : trainer.subscriptionStatus === 'ACTIVE'
              ? (trainer.subscriptionPlanName ?? 'Active')
              : (trainer.subscriptionStatus ?? 'No plan')}
        </span>
        {graceActive && (
          <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300" title={`Grace access until ${formatDate(graceUntil!)}`}>
            Grace
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-300">{trainer.clientCount}</td>
      <td className="px-4 py-3">
        {(() => {
          // While the trainer is still on first-run sample data, onboarding
          // progress is derived from their (empty) real data and reads as 0/N
          // — misleading. Show a "Sample data" badge instead until they clear
          // it, then the live progress bar takes over.
          if (trainer.sampleClientCount > 0) {
            return (
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-cyan-900 text-cyan-300"
                title={`Still on first-run sample data — ${trainer.sampleClientCount} sample client${trainer.sampleClientCount === 1 ? '' : 's'} not yet cleared`}
              >
                Sample data
              </span>
            )
          }
          const { onboardingCompleted: done, onboardingTotal: total } = trainer
          const pct = total > 0 ? Math.round((done / total) * 100) : 0
          const complete = total > 0 && done >= total
          return (
            <div className="flex items-center gap-2" title={`${done} of ${total} onboarding steps complete`}>
              <div className="w-14 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full ${complete ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`text-xs tabular-nums ${complete ? 'text-green-300' : 'text-slate-300'}`}>{done}/{total}</span>
            </div>
          )
        })()}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 tabular-nums" title={`${trainer.onboardingEmails} onboarding email${trainer.onboardingEmails === 1 ? '' : 's'} sent`}>
          {trainer.onboardingEmails} sent
        </span>
      </td>
      <td className="px-4 py-3 text-slate-400">
        <span className="group relative inline-block">
          <span className="cursor-default border-b border-dotted border-slate-500/60 tabular-nums">
            {joinedLabel(trainer.createdAt)}
          </span>
          {/* Hover tooltip with the full join timestamp (native title is
              unreliable — same instant-tooltip pattern as the email one above). */}
          <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 shadow-lg ring-1 ring-slate-700 group-hover:block">
            Joined {new Date(trainer.createdAt).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 text-slate-400">
        {trainer.lastLoginAt ? (
          <span className="group relative inline-block">
            <span className="cursor-default border-b border-dotted border-slate-500/60 tabular-nums">
              {lastSeenLabel(trainer.lastLoginAt)}
            </span>
            <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 shadow-lg ring-1 ring-slate-700 group-hover:block">
              Last seen {new Date(trainer.lastLoginAt).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          </span>
        ) : (
          <span className="text-slate-500" title="No sign-in recorded yet">Never</span>
        )}
      </td>
      <td className="px-4 py-3">
        {(() => {
          if (!trialEnds) return <span className="text-slate-500">—</span>
          const days = Math.ceil((trialEnds.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          const expired = days < 0
          return (
            <span
              className={`text-sm ${expired ? 'text-rose-300' : days <= 3 ? 'text-amber-300' : 'text-slate-300'}`}
              title={expired ? 'Trial expired' : `${days} day${days === 1 ? '' : 's'} left`}
            >
              {formatDate(trialEnds)}
              <span className="ml-1 text-xs text-slate-500">
                {expired ? '(expired)' : `(${days}d)`}
              </span>
            </span>
          )
        })()}
      </td>
      <td className="px-4 py-3 align-middle">
        {/* Center the icon inside every control identically. The impersonate
            action is an <a> while the rest are <button>s, so relying on default
            element layout left its icon off-centre; forcing each direct child to
            inline-flex + center makes them all line up regardless of tag. */}
        <div className="flex items-center justify-end gap-1 whitespace-nowrap [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center">
          <button
            onClick={toggleEmails}
            className={`p-1.5 rounded-lg hover:bg-slate-700 transition-colors ${showEmails ? 'text-blue-400 bg-slate-700' : 'text-slate-400 hover:text-blue-400'}`}
            title="Onboarding & trial emails"
            aria-expanded={showEmails}
          >
            <Mail className="h-3.5 w-3.5" />
          </button>
          <a
            href={`/api/admin/impersonate/${trainer.id}`}
            className="p-1.5 text-slate-400 hover:text-green-400 rounded-lg hover:bg-slate-700 transition-colors"
            title={`Log in as ${trainer.name ?? trainer.email}`}
          >
            <LogIn className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-slate-400 hover:text-blue-400 rounded-lg hover:bg-slate-700 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

          {isActive ? (
            // Active account → soft-delete (deactivate), with inline confirm.
            confirmDeactivate ? (
              <div className="flex items-center gap-1.5 ml-1">
                <span className="text-xs text-amber-400">Deactivate?</span>
                <button onClick={() => setActive(false)} disabled={togglingActive} className="text-xs text-amber-400 hover:text-amber-300 font-medium disabled:opacity-50">
                  {togglingActive ? '…' : 'Yes'}
                </button>
                <button onClick={() => setConfirmDeactivate(false)} className="text-xs text-slate-500 hover:text-slate-300">No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeactivate(true)}
                className="p-1.5 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-700 transition-colors"
                title="Deactivate (block sign-in, keep data)"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            )
          ) : (
            // Deactivated account → reinstate OR permanently delete.
            <>
              <button
                onClick={() => setActive(true)}
                disabled={togglingActive}
                className="p-1.5 text-slate-400 hover:text-green-400 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
                title="Reactivate account"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setConfirmText(''); setShowHardDelete(true) }}
                className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700 transition-colors"
                title="Delete permanently"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {/* Errors render below the icon row so a failed action never shifts the
            icons out of alignment with the other rows. */}
        {error && <p className="text-red-400 text-xs mt-1 text-right max-w-[14rem] ml-auto">{error}</p>}

        {/* Permanent-delete confirmation modal — requires typing the email.
            Portaled to <body> so it escapes the table's stacking context (else
            other rows bleed through it) and rendered on a solid background. */}
        {showHardDelete && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            onClick={() => !deleting && setShowHardDelete(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-red-950 p-2 text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Permanently delete this account?</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    This erases <span className="text-slate-200">{trainer.name ?? trainer.email}</span> and
                    all of their data — clients, dogs, sessions, packages, and history.
                    <span className="text-red-300"> This cannot be undone.</span>
                  </p>
                </div>
              </div>

              <label className="block text-xs text-slate-400 mt-5 mb-1.5">
                Type <span className="text-slate-200 font-medium select-all">{trainer.email}</span> to confirm
              </label>
              <input
                autoFocus
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={trainer.email}
                className="w-full h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />

              {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowHardDelete(false)}
                  disabled={deleting}
                  className="text-sm text-slate-300 hover:text-white px-4 h-9 rounded-lg border border-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleHardDelete}
                  disabled={deleting || confirmText.trim() !== trainer.email}
                  className="flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-4 h-9 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </td>
    </tr>
    {showEmails && (
      <tr className="bg-slate-900/60">
        <td colSpan={10} className="px-4 py-4">
          {loadingReport ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading email history…
            </div>
          ) : reportError ? (
            <p className="text-sm text-rose-400">{reportError}</p>
          ) : report ? (
            <div className="flex flex-col gap-4">
              {!report.enrolled && report.enrollmentNote && (
                <p className="text-xs px-3 py-2 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-500/30">
                  {report.enrollmentNote}
                </p>
              )}

              {/* One combined, chronological table — sent history first, then
                  what's queued. Clearer than the old Received | Upcoming split. */}
              {report.sent.length === 0 && report.upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">No onboarding emails for this trainer.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">When (NZT)</th>
                        <th className="px-3 py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...report.sent.map(e => ({
                          rowKey: `sent-${e.key}`,
                          subject: e.subject,
                          note: null as string | null,
                          status: 'sent' as 'sent' | 'eligible' | 'scheduled' | 'waiting' | 'skip',
                          when: formatDateTime(e.sentAt, 'Pacific/Auckland'),
                        })),
                        ...report.upcoming.map(e => ({
                          rowKey: `up-${e.key}`,
                          subject: e.subject,
                          note: e.note,
                          status: e.status,
                          when:
                            e.status === 'eligible' ? 'Within the hour' :
                            e.status === 'scheduled' ? (e.dueAt ? `~9am ${formatDate(e.dueAt)}` : 'Scheduled') :
                            '—',
                        })),
                      ].map(r => {
                        const chip =
                          r.status === 'sent' ? 'bg-emerald-900 text-emerald-300' :
                          r.status === 'eligible' ? 'bg-blue-900 text-blue-300' :
                          r.status === 'scheduled' ? 'bg-slate-700 text-slate-300' :
                          r.status === 'waiting' ? 'bg-purple-900/70 text-purple-300' :
                          'bg-slate-800 text-slate-500'
                        const chipLabel =
                          r.status === 'sent' ? 'Sent' :
                          r.status === 'eligible' ? 'Sending soon' :
                          r.status === 'scheduled' ? 'Scheduled' :
                          r.status === 'waiting' ? 'Waiting' :
                          'Won’t send'
                        return (
                          <tr key={r.rowKey} className={`border-b border-slate-700/40 last:border-0 ${r.status === 'skip' ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2 align-top">
                              <div className="text-slate-200">{r.subject}</div>
                              {r.note && <div className="text-xs text-slate-500">{r.note}</div>}
                            </td>
                            <td className="px-3 py-2 align-top text-xs text-slate-400 tabular-nums whitespace-nowrap">{r.when}</td>
                            <td className="px-3 py-2 align-top text-right">
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${chip}`}>
                                {r.status === 'sent' && <Check className="h-3 w-3" />}
                                {chipLabel}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {report.enrolled && (
                <p className="text-[11px] text-slate-500">
                  Times in NZT. Time-based emails go out in the ~9am batch in the trainer’s timezone ({report.timezone}); the welcome sends within the hour of signup.
                </p>
              )}
            </div>
          ) : null}
        </td>
      </tr>
    )}
    </>
  )
}
