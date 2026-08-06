'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { Ticket, Loader2, Check, Lock, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { resolveButtonColors } from '@/lib/membership-card-colors'
import { MembershipConsentScreen } from '@/components/shared/membership-consent-screen'
import { resolveCardAction } from '@/lib/membership-card-action'
import type { ClientMembership, ClientMembershipInterval, ClientSubscription } from '@/lib/client-memberships'

const INTERVAL_LABEL: Record<ClientMembershipInterval, string> = {
  WEEK: 'week',
  FORTNIGHT: 'fortnight',
  MONTH: 'month',
}

/**
 * "$60.00 / 6 weeks" for a recurring plan, plain money for a one-off.
 *
 * The FIRST BILLING OPTION wins when there is one, because that is the plan the
 * buy route actually sells when no planId is sent — and it is the row that
 * carries the real cycle. `Membership.interval` is a headline field with no
 * editor behind it (it is always MONTH), so reading the price off it told a
 * client on an every-6-weeks plan that they were paying "/ month".
 *
 * The plan's own `priceLabel` is built server-side by the same function as the
 * consent sentence, so the card and the agreement cannot drift.
 */
function priceLabel(m: ClientMembership, currency: string): string {
  const plan = m.plans[0]
  if (plan) return plan.priceLabel
  const base = formatMoney(m.priceCents, currency)
  return m.interval ? `${base} / ${INTERVAL_LABEL[m.interval]}` : base
}

/**
 * The client-facing membership cards + their buy action. Shared by the
 * Memberships storefront page and the Offerings flow's "Memberships" type, so a
 * trainer's card styling (image, colours, custom button text) renders
 * identically wherever a client meets it.
 */
export function MembershipCards({
  memberships,
  currency,
  /**
   * The recurring plan the client is on right now, if any. Its presence turns
   * every OTHER recurring card from "Subscribe" into "Move to this one" —
   * without it a client on Juniors would be offered a second subscription
   * alongside it rather than a change of plan.
   */
  currentPlan = null,
}: {
  memberships: ClientMembership[]
  currency: string
  currentPlan?: ClientSubscription | null
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A switch that has gone through — the card confirms rather than silently
  // reloading, because moving plan takes money and should say so.
  const [switched, setSwitched] = useState<string | null>(null)
  // Which membership's consent screen is open. A recurring plan never goes
  // straight to Stripe — it has to be agreed to first.
  const [consentFor, setConsentFor] = useState<string | null>(null)
  // Seeded from the server (a PENDING MembershipRequest row), so "Requested"
  // is still there after a reload rather than a state flip that forgets.
  const [requested, setRequested] = useState<Record<string, boolean>>(
    () => Object.fromEntries(memberships.filter(m => m.requested).map(m => [m.id, true])),
  )

  async function request(id: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/${id}/request`, { method: 'POST' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not send that request.'); return }
      // The route is idempotent, so a second tap lands here too and simply
      // confirms what's already true — the trainer is told once.
      setRequested(prev => ({ ...prev, [id]: true }))
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Start checkout. A one-off goes straight to Stripe; a recurring plan only
   * reaches here once the consent screen has been agreed to, and sends
   * `consent: true` — the route refuses the subscription without it, so a
   * client can never be signed up to a repeating charge by a stray tap.
   */
  async function buy(id: string, opts?: { consent?: boolean; planId?: string }) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/${id}/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: opts?.consent ?? false, planId: opts?.planId }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not start checkout.'); return }
      if (b.url) window.location.href = b.url
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Move an existing subscription onto this package.
   *
   * Deliberately a different call from `buy`: buying would open a SECOND
   * subscription beside the one they already pay for. The route re-prices the
   * existing one instead, and there is no Stripe redirect — the card they are
   * already being charged on is the card this uses.
   */
  async function switchTo(id: string, planId?: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/${id}/switch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: true, planId }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not change your plan.'); return }
      setConsentFor(null)
      setSwitched(id)
      // The subscriptions list above the cards is server-rendered, so it has to
      // be re-fetched for the change to show. Reloading after the confirmation
      // is set means they see it land rather than a blank flash.
      setTimeout(() => window.location.reload(), 1200)
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(null)
    }
  }

  const consenting = memberships.find(m => m.id === consentFor) ?? null

  if (memberships.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No packages available right now.</div>
  }

  return (
    <>
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}
      <div className="flex flex-col gap-4">
        {memberships.map(m => {
          const bg = m.bgColor ?? '#ffffff'
          const header = m.headerColor ?? '#0f172a'
          const text = m.textColor ?? '#64748b'
          const featured = m.featuredColor ?? '#7c3aed'
          // Never paint the trainer's raw pair — the guard derives a label tone
          // that clears 4.5:1 on whatever background they chose.
          const btn = resolveButtonColors(m.buttonBgColor, m.buttonTextColor, m.featuredColor)
          // One decision, made in client-memberships.ts where it can be
          // tested, rather than a ladder of conditions inside the JSX.
          const action = resolveCardAction(m, currentPlan)
          const locked = action.kind === 'LOCKED'
          return (
            <div
              key={m.id}
              // A stable handle on the whole card. The specs used to reach for
              // it with .filter({ has: heading }).last(), which resolves to the
              // innermost <div> holding the title — so every assertion about
              // the PRICE or the button, which are siblings of that div, could
              // never pass.
              data-testid="membership-card"
              className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
              style={{ backgroundColor: bg }}
            >
              {m.imageUrl && (
                // Desaturated rather than hidden: they should still see what
                // they're working towards.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className={`w-full h-36 object-cover ${locked ? 'grayscale opacity-60' : ''}`} />
              )}
              <div className={`p-5 ${locked ? 'opacity-75' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-lg flex items-center gap-2" style={{ color: header }}><Ticket className="h-5 w-5 shrink-0" style={{ color: featured }} /> {m.name}</h2>
                    <div className="mt-1" style={{ color: text }}><RichText html={m.description} className="text-sm" /></div>
                  </div>
                  <span className="text-lg font-bold whitespace-nowrap" style={{ color: featured }}>{priceLabel(m, currency)}</span>
                </div>
                {m.items.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {m.items.map((it, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-black/10 shrink-0" />
                        ) : (
                          <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: featured }} />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm" style={{ color: header }}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</p>
                          {it.description && <div style={{ color: text }}><RichText html={it.description} className="text-xs" /></div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Recurring plans have no mandate layer yet and an unpriced one
                    has nothing to charge, so the buy route 409s both. Rather
                    than a dead sentence telling the client to go and message
                    someone, they get one tap that tells the trainer — with the
                    reason still stated right above it, and the trainer's own
                    button colours so the card doesn't look half-styled. */}
                {action.kind === 'LOCKED' ? (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" strokeWidth={1.75} />
                    <p className="text-sm text-slate-600">{action.copy}</p>
                  </div>
                ) : switched === m.id ? (
                  <p className="mt-4 flex items-center justify-center gap-2 h-11 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700">
                    <Check className="h-4 w-4" strokeWidth={1.75} /> You&apos;re on {m.name} now
                  </p>
                ) : action.kind === 'SWITCH' ? (
                  <>
                    <p className="mt-4 text-sm" style={{ color: text }}>
                      {action.copy} Then it’s {priceLabel(m, currency)}.
                    </p>
                    <button
                      onClick={() => setConsentFor(m.id)}
                      disabled={busy === m.id}
                      className="mt-2 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: btn.background, color: btn.color }}
                    >
                      {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : action.movingUp ? <ArrowUpRight className="h-4 w-4" strokeWidth={2} /> : <ArrowDownRight className="h-4 w-4" strokeWidth={2} />}
                      {action.movingUp ? 'Move up to this' : 'Move to this'}
                    </button>
                  </>
                ) : action.kind === 'SUBSCRIBED' ? (
                  // Already paying for it. Selling it again would stack a second
                  // recurring charge on the same plan.
                  <p className="mt-4 flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
                    <Check className="h-4 w-4" strokeWidth={1.75} /> You&apos;re on this plan
                  </p>
                ) : action.kind === 'BUY' ? (
                  <button
                    onClick={() => (action.needsConsent ? setConsentFor(m.id) : buy(m.id))}
                    disabled={busy === m.id}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: btn.background, color: btn.color }}
                  >
                    {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {m.buttonText?.trim() || (action.needsConsent ? 'Subscribe' : 'Get this package')}
                  </button>
                ) : (
                  <>
                    <p className="mt-4 text-sm" style={{ color: text }}>
                      {action.kind === 'REQUEST' ? action.copy : ''}
                    </p>
                    {requested[m.id] ? (
                      <p className="mt-2 flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
                        <Check className="h-4 w-4" /> Requested — you&apos;ll hear back soon
                      </p>
                    ) : (
                      <button onClick={() => request(m.id)} disabled={busy === m.id} className="mt-2 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: btn.background, color: btn.color }}>
                        {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Request this
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {consenting && (
        <MembershipConsentScreen
          membership={consenting}
          busy={busy === consenting.id}
          error={error}
          onCancel={() => { setConsentFor(null); setError(null) }}
          onConfirm={(planId) => {
            const chosen = planId ?? consenting.plans[0]?.id
            // Same screen, two destinations: someone already paying is CHANGING
            // an agreement, not entering their first one.
            return currentPlan && consenting.id !== currentPlan.membershipId && consenting.cadence === 'RECURRING'
              ? switchTo(consenting.id, chosen)
              : buy(consenting.id, { consent: true, planId: chosen })
          }}
        />
      )}
    </>
  )
}
