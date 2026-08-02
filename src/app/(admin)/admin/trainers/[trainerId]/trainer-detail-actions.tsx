'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Gift } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ADDONS } from '@/lib/pricing'
import { apiErrorMessage } from '@/lib/api-error-message'

// All the mutating controls for a single trainer, laid out as full-page cards.
// These call the same /api/admin/trainers/[id] endpoints the old inline table
// row used; the full view just gives them room to breathe. Read-only display
// (header, stats, email history) lives in the server page and refreshes via
// router.refresh() after each action.
type Props = {
  id: string
  name: string | null
  email: string | null
  businessName: string | null
  subscriptionStatus: string | null
  trialEndsAt: string | null
  gracePeriodUntil: string | null
  seatCount: number
  isInternal: boolean
  // Rollout gates — features that are merged but off until a business is
  // deliberately switched on. Both default false in the database.
  recurringPaymentsEnabled: boolean
  tapToPayEnabled: boolean
  // Active admin comp grants: free add-on previews with an optional expiry.
  addonGrants: { itemId: string; expiresAt: string | null }[]
  // Every TrainerAddon row this business holds — what's on, and which of those
  // are a real billed line item on their Stripe subscription.
  addonState: { itemId: string; active: boolean; grantedByAdmin: boolean; billed: boolean }[]
}

// Add-ons an admin can comp — everything in the catalog except coming-soon
// previews (which aren't usable yet).
const GRANTABLE_ADDONS = ADDONS.filter(a => !a.comingSoon).map(a => ({ id: a.id, name: a.name }))

// The same set, but carrying whether it costs anything — the admin needs to know
// which of these buttons puts a charge on a real customer's invoice.
const SWITCHABLE_ADDONS = ADDONS.filter(a => !a.comingSoon).map(a => ({
  id: a.id,
  name: a.name,
  free: !!a.free,
}))

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

  const [name, setName] = useState(props.name ?? '')
  const [email, setEmail] = useState(props.email)
  const [businessName, setBusinessName] = useState(props.businessName ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [savingTrial, setSavingTrial] = useState(false)
  // Free-text trial length. Kept as a string so the field can be empty while
  // typing; `customTrialDays` is the validated number, null when unusable.
  const [customTrial, setCustomTrial] = useState('')
  const [savingGrace, setSavingGrace] = useState(false)
  const [savingSeats, setSavingSeats] = useState(false)
  const [savingInternal, setSavingInternal] = useState(false)
  // One busy key for the gates — which gate is mid-save, or null.
  const [savingGate, setSavingGate] = useState<string | null>(null)

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

  // ── Throw the trainer's own switch, for them ──────────────────────────────
  // PATCHes the same route the comps POST to, but a PATCH runs the REAL change:
  // the same applyAddonChange the trainer's Add-ons page calls, so it goes
  // through Stripe and lands on their invoice. Never a direct database edit —
  // that is how a customer ends up with a paid feature nobody is charging for.
  const [changingId, setChangingId] = useState<string | null>(null)
  const [changeNote, setChangeNote] = useState<string | null>(null)
  const addonOn = new Map(props.addonState.map(a => [a.itemId, a]))

  async function changeAddon(itemId: string, active: boolean) {
    setChangingId(itemId)
    setError(null)
    setChangeNote(null)
    try {
      const res = await fetch(`/api/admin/trainers/${props.id}/addons`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, active }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The route's own sentence, verbatim — it is the same one the trainer
        // would have seen, which is the point of an admin trying it here.
        setError(apiErrorMessage(body, res.status, { fallback: 'Failed to change add-on' }))
        return
      }
      setChangeNote(
        body.comped ? 'Changed with no charge (sandbox account).'
          : body.billsAtTrialEnd ? 'On now, free until their trial ends — it joins the bill when they subscribe.'
          : 'Done — their Stripe subscription was updated, pro-rated to their next invoice.',
      )
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setChangingId(null)
    }
  }

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


  // Mirrors the route's own bounds (1–3650), so an out-of-range number simply
  // leaves Apply disabled rather than making a request that 400s.
  const parsedTrial = Number(customTrial)
  const customTrialDays =
    customTrial.trim() !== '' && Number.isInteger(parsedTrial) && parsedTrial >= 1 && parsedTrial <= 3650
      ? parsedTrial
      : null

  async function applyCustomTrial() {
    if (customTrialDays === null) return
    const ok = await patch({ applyTrialDays: customTrialDays }, setSavingTrial, 'Failed to apply trial')
    if (ok) setCustomTrial('')
  }

  // The rollout gates, described in the words of the person deciding. Each is a
  // boolean column on TrainerProfile that the PATCH route already accepts —
  // adding a gate is one entry here, not a screen.
  const gates: { field: string; name: string; on: boolean; blurb: string }[] = [
    {
      field: 'tapToPayEnabled',
      name: 'Tap to Pay',
      on: props.tapToPayEnabled,
      blurb: 'Take a card on the trainer’s own phone. Needs a native build carrying Apple’s entitlement — switching this on before one is in the stores gives them a row that cannot work.',
    },
    {
      field: 'recurringPaymentsEnabled',
      name: 'Recurring memberships',
      on: props.recurringPaymentsEnabled,
      blurb: 'Their clients can subscribe to a membership — a real Stripe Subscription on this trainer’s connected account, charged every month until cancelled.',
    },
  ]

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
            <input value={email ?? ''} onChange={e => setEmail(e.target.value)}
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
          {/* Any length, not just the three common ones. The route already
              accepts 1–3650 days, so this needed no API change. */}
          <span className="text-slate-600 px-1">or</span>
          <input
            type="number" min={1} max={3650} value={customTrial} placeholder="days"
            onChange={e => setCustomTrial(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyCustomTrial() }}
            className="h-8 w-20 rounded-lg bg-slate-900 border border-slate-600 px-2 text-xs text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={applyCustomTrial} disabled={savingTrial || !customTrialDays}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 h-8 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {savingTrial ? 'Applying…' : 'Apply'}
          </button>
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

      {/* Rollout gates — merged features, off until someone decides otherwise */}
      <div className={card}>
        <h2 className={cardTitle}>Rollout gates</h2>
        <p className="text-sm text-slate-400 mb-4">
          Features that are built and shipped but off for everyone until a business
          is switched on here. Off is the default and the safe answer — a new
          account never inherits one of these.
        </p>
        <ul className="flex flex-col gap-2">
          {gates.map(g => {
            const busy = savingGate === g.field
            return (
              <li key={g.field} className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">
                    {g.name}
                    {g.on
                      ? <span className="ml-2 text-xs font-normal text-emerald-300">On</span>
                      : <span className="ml-2 text-xs font-normal text-slate-500">Off</span>}
                  </p>
                  <p className="text-xs text-slate-500">{g.blurb}</p>
                </div>
                <button
                  onClick={() => patch({ [g.field]: !g.on }, b => setSavingGate(b ? g.field : null), `Failed to update ${g.name}`)}
                  disabled={busy}
                  className={`text-xs px-3 h-8 rounded-lg disabled:opacity-50 ${
                    g.on
                      ? 'text-rose-300 hover:text-rose-200 border border-rose-500/40'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {busy ? '…' : g.on ? 'Switch off' : 'Switch on'}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Their own add-on switches, thrown by us — through Stripe, not the DB */}
      <div className={card}>
        <h2 className={cardTitle}>Add-ons (their real switch)</h2>
        <p className="text-sm text-slate-400 mb-4">
          Turns an add-on on or off exactly as the trainer would, through Stripe — a paid
          one is added to their subscription and pro-rated onto their next invoice. Use
          this when they can’t do it themselves. For a free trial of a paid add-on, use
          Add-on comps above instead; this one charges them.
        </p>

        {changeNote && (
          <p className="mb-3 rounded-xl border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{changeNote}</p>
        )}

        <ul className="flex flex-col gap-2">
          {SWITCHABLE_ADDONS.map(a => {
            const row = addonOn.get(a.id)
            const on = row?.active ?? false
            const busy = changingId === a.id
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5">
                <span className="text-sm font-medium text-slate-200">{a.name}</span>
                {on
                  ? <span className="text-xs text-emerald-300">On</span>
                  : <span className="text-xs text-slate-500">Off</span>}
                <span className="text-xs text-slate-600">{a.free ? 'Free' : 'Paid'}</span>
                {row?.grantedByAdmin && <span className="text-xs text-amber-300">Comped</span>}
                {on && !a.free && !row?.billed && (
                  // On locally with no Stripe line behind it — a trial switch-on,
                  // or a subscription we never managed to update. Worth naming:
                  // it is a paid feature nobody is being charged for.
                  <span className="text-xs text-amber-300">Not billed</span>
                )}
                <button
                  onClick={() => changeAddon(a.id, !on)}
                  disabled={busy || changingId !== null}
                  className={`ml-auto text-xs px-3 h-8 rounded-lg disabled:opacity-50 ${
                    on
                      ? 'text-rose-300 hover:text-rose-200 border border-rose-500/40'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {busy ? '…' : on ? 'Switch off' : 'Switch on'}
                </button>
              </li>
            )
          })}
        </ul>
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

    </div>
  )
}
