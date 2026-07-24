'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, X, AlertTriangle, Trash2, Ban, RotateCcw, Loader2, Gift } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ADDONS } from '@/lib/pricing'

// All the mutating controls for a single trainer, laid out as full-page cards.
// These call the same /api/admin/trainers/[id] endpoints the old inline table
// row used; the full view just gives them room to breathe. Read-only display
// (header, stats, email history) lives in the server page and refreshes via
// router.refresh() after each action.
type Props = {
  id: string
  name: string | null
  email: string
  businessName: string | null
  subscriptionStatus: string | null
  trialEndsAt: string | null
  gracePeriodUntil: string | null
  seatCount: number
  isInternal: boolean
  deactivatedAt: string | null
  // Active admin comp grants: free add-on previews with an optional expiry.
  addonGrants: { itemId: string; expiresAt: string | null }[]
}

// Add-ons an admin can comp — everything in the catalog except coming-soon
// previews (which aren't usable yet).
const GRANTABLE_ADDONS = ADDONS.filter(a => !a.comingSoon).map(a => ({ id: a.id, name: a.name }))

const DAY_MS = 24 * 60 * 60 * 1000
// yyyy-mm-dd N days from now, for the default expiry date input.
function dateInputValue(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * DAY_MS).toISOString().slice(0, 10)
}
// Whole days until an ISO instant (rounded up); negative once past.
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS)
}

const card = 'rounded-2xl border border-slate-700 bg-slate-800 p-5'
const cardTitle = 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3'

export function TrainerDetailActions(props: Props) {
  const router = useRouter()
  const isActive = !props.deactivatedAt

  const [name, setName] = useState(props.name ?? '')
  const [email, setEmail] = useState(props.email)
  const [businessName, setBusinessName] = useState(props.businessName ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [savingTrial, setSavingTrial] = useState(false)
  const [savingGrace, setSavingGrace] = useState(false)
  const [savingSeats, setSavingSeats] = useState(false)
  const [savingInternal, setSavingInternal] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)

  const [showHardDelete, setShowHardDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Add-on comps.
  const grantedIds = new Set(props.addonGrants.map(g => g.itemId))
  const ungranted = GRANTABLE_ADDONS.filter(a => !grantedIds.has(a.id))
  const [newAddon, setNewAddon] = useState('')
  const [newExpiry, setNewExpiry] = useState(dateInputValue(30))
  const [noExpiry, setNoExpiry] = useState(false)
  const [grantingId, setGrantingId] = useState<string | null>(null)

  // Grant / extend / revoke a comp. expiresAtISO null = no expiry; active:false
  // revokes. Posts to the dedicated addons route (never touches Stripe).
  async function grant(itemId: string, active: boolean, expiresAtISO: string | null) {
    setGrantingId(itemId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/trainers/${props.id}/addons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, active, expiresAt: expiresAtISO }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update add-on')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update add-on')
    } finally {
      setGrantingId(null)
    }
  }

  // End-of-day ISO for a yyyy-mm-dd date input, so a comp lasts the whole day.
  const endOfDayISO = (ymd: string) => new Date(`${ymd}T23:59:59`).toISOString()

  // Shared PATCH helper — every subscription/account action funnels through it.
  async function patch(body: Record<string, unknown>, setBusy: (b: boolean) => void, fail: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/trainers/${props.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : fail)
      }
      router.refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : fail)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile() {
    setProfileSaved(false)
    const ok = await patch({ name, email, businessName }, setSavingProfile, 'Failed to save')
    if (ok) setProfileSaved(true)
  }

  async function handleHardDelete() {
    setDeleting(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${props.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/admin/trainers')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Failed to delete trainer')
      setShowHardDelete(false)
      setDeleting(false)
    }
  }

  const graceUntil = props.gracePeriodUntil ? new Date(props.gracePeriodUntil) : null
  const graceActive = !!graceUntil && graceUntil.getTime() > Date.now()
  const trialEnds = props.trialEndsAt ? new Date(props.trialEndsAt) : null

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {/* Profile */}
      <div className={card}>
        <h2 className={cardTitle}>Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-slate-400">Name</span>
            <input value={name} onChange={e => setName(e.target.value)}
              className="h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-slate-400">Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)}
              className="h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-slate-400">Business name</span>
            <input value={businessName} onChange={e => setBusinessName(e.target.value)}
              className="h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={saveProfile} disabled={savingProfile}
            className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 h-10 rounded-lg disabled:opacity-50">
            <Check className="h-4 w-4" /> {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
          {profileSaved && <span className="text-xs text-green-400">Saved ✓</span>}
        </div>
      </div>

      {/* Subscription & access */}
      <div className={card}>
        <h2 className={cardTitle}>Subscription &amp; access</h2>

        <p className="text-sm text-slate-400 mb-2">
          Trial
          {trialEnds
            ? <span className="text-slate-200"> · ends {formatDate(trialEnds)}</span>
            : <span className="text-slate-500"> · none</span>}
        </p>
        <div className="flex gap-2 flex-wrap items-center mb-5">
          {[30, 60, 100].map(d => (
            <button key={d} onClick={() => patch({ applyTrialDays: d }, setSavingTrial, 'Failed to apply trial')} disabled={savingTrial}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50">
              {d}-day trial
            </button>
          ))}
        </div>

        <p className="text-sm text-slate-400 mb-2">
          Trainer seats <span className="text-slate-200">· currently {props.seatCount} seat{props.seatCount === 1 ? '' : 's'}</span>
        </p>
        <div className="flex gap-2 flex-wrap items-center mb-5">
          {[1, 2, 3, 5, 10].map(n => (
            <button key={n} onClick={() => patch({ seatCount: n }, setSavingSeats, 'Failed to update seats')} disabled={savingSeats || props.seatCount === n}
              className={`text-xs px-3 h-8 rounded-lg disabled:opacity-50 ${
                props.seatCount === n ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}>
              {n} seat{n === 1 ? '' : 's'}
            </button>
          ))}
        </div>

        <p className="text-sm text-slate-400 mb-2">
          Access grace period
          {graceActive
            ? <span className="text-green-300"> · active until {formatDate(graceUntil!)}</span>
            : <span className="text-slate-500"> · none</span>}
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          {[7, 14, 30].map(d => (
            <button key={d}
              onClick={() => patch({ gracePeriodUntil: new Date(Date.now() + d * 864e5).toISOString() }, setSavingGrace, 'Failed to update grace period')}
              disabled={savingGrace}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50">
              +{d} days
            </button>
          ))}
          {graceActive && (
            <button onClick={() => patch({ gracePeriodUntil: null }, setSavingGrace, 'Failed to update grace period')} disabled={savingGrace}
              className="text-xs text-rose-300 hover:text-rose-200 px-3 h-8 rounded-lg border border-rose-500/40 disabled:opacity-50">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Add-on comps — free previews with an expiry */}
      <div className={card}>
        <h2 className={cardTitle}>Add-on comps (free trials)</h2>
        <p className="text-sm text-slate-400 mb-4">
          Switch an add-on on for free so they can try it — no charge. It silently
          switches off at the expiry date, and they get an email 2 days before it ends.
        </p>

        {props.addonGrants.length > 0 ? (
          <ul className="flex flex-col gap-2 mb-4">
            {props.addonGrants.map(g => {
              const name = GRANTABLE_ADDONS.find(a => a.id === g.itemId)?.name ?? g.itemId
              const left = g.expiresAt ? daysUntil(g.expiresAt) : null
              const busy = grantingId === g.itemId
              return (
                <li key={g.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-200">{name}</span>
                  {g.expiresAt == null ? (
                    <span className="text-xs text-slate-400">No expiry</span>
                  ) : left! <= 0 ? (
                    <span className="text-xs text-rose-300">Expired</span>
                  ) : (
                    <span className={`text-xs ${left! <= 3 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {left} day{left === 1 ? '' : 's'} left · ends {formatDate(new Date(g.expiresAt))}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => grant(g.itemId, true, new Date((g.expiresAt ? new Date(g.expiresAt).getTime() : Date.now()) + 30 * DAY_MS).toISOString())}
                      disabled={busy}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50">
                      {busy ? '…' : '+30 days'}
                    </button>
                    <button
                      onClick={() => grant(g.itemId, false, null)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200 px-3 h-8 rounded-lg border border-rose-500/40 disabled:opacity-50">
                      <X className="h-3 w-3" /> Revoke
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 mb-4">No comped add-ons.</p>
        )}

        {ungranted.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-700/60 pt-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400 text-xs">Add-on</span>
              <select value={newAddon} onChange={e => setNewAddon(e.target.value)}
                className="h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Choose…</option>
                {ungranted.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400 text-xs">Expires</span>
              <input type="date" value={newExpiry} disabled={noExpiry} onChange={e => setNewExpiry(e.target.value)}
                className="h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 h-10 select-none">
              <input type="checkbox" checked={noExpiry} onChange={e => setNoExpiry(e.target.checked)} className="accent-blue-500" /> No expiry
            </label>
            <button
              onClick={() => grant(newAddon, true, noExpiry ? null : endOfDayISO(newExpiry))}
              disabled={!newAddon || grantingId === newAddon}
              className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 h-10 rounded-lg disabled:opacity-50">
              {grantingId === newAddon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />} Grant free
            </button>
          </div>
        )}
      </div>

      {/* Account type */}
      <div className={card}>
        <h2 className={cardTitle}>Account type</h2>
        <p className="text-sm text-slate-400 mb-3">
          {props.isInternal
            ? <span className="text-purple-300">PupManager (internal / test)</span>
            : <span className="text-slate-300">Real customer</span>}
          <span className="text-slate-500"> — internal accounts are hidden from platform metrics and onboarding emails.</span>
        </p>
        <button onClick={() => patch({ isInternal: !props.isInternal }, setSavingInternal, 'Failed to update account flag')} disabled={savingInternal}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50">
          {props.isInternal ? 'Unmark as ours' : 'Mark as ours (internal)'}
        </button>
      </div>

      {/* Danger zone */}
      <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-rose-400/80 mb-3">Danger zone</h2>
        {isActive ? (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => patch({ active: false }, setTogglingActive, 'Failed to update account')} disabled={togglingActive}
              className="inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200 px-4 h-10 rounded-lg border border-amber-500/40 disabled:opacity-50">
              <Ban className="h-4 w-4" /> {togglingActive ? 'Deactivating…' : 'Deactivate (block sign-in, keep data)'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => patch({ active: true }, setTogglingActive, 'Failed to update account')} disabled={togglingActive}
              className="inline-flex items-center gap-1.5 text-sm text-green-300 hover:text-green-200 px-4 h-10 rounded-lg border border-green-500/40 disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> {togglingActive ? 'Reactivating…' : 'Reactivate account'}
            </button>
            <button onClick={() => { setConfirmText(''); setShowHardDelete(true) }}
              className="inline-flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-4 h-10 rounded-lg">
              <Trash2 className="h-4 w-4" /> Delete permanently
            </button>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-3">
          An account must be deactivated before it can be permanently deleted.
        </p>
      </div>

      {/* Permanent-delete confirmation modal — requires typing the email. */}
      {showHardDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => !deleting && setShowHardDelete(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-950 p-2 text-red-400"><AlertTriangle className="h-5 w-5" /></div>
              <div>
                <h2 className="text-base font-semibold text-white">Permanently delete this account?</h2>
                <p className="text-sm text-slate-400 mt-1">
                  This erases <span className="text-slate-200">{props.name ?? props.email}</span> and all of their data —
                  clients, dogs, sessions, packages, and history.
                  <span className="text-red-300"> This cannot be undone.</span>
                </p>
              </div>
            </div>
            <label className="block text-xs text-slate-400 mt-5 mb-1.5">
              Type <span className="text-slate-200 font-medium select-all">{props.email}</span> to confirm
            </label>
            <input autoFocus value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={props.email}
              className="w-full h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowHardDelete(false)} disabled={deleting}
                className="text-sm text-slate-300 hover:text-white px-4 h-9 rounded-lg border border-slate-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleHardDelete} disabled={deleting || confirmText.trim() !== props.email}
                className="inline-flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-4 h-9 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
