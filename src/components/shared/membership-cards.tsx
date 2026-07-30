'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { Ticket, Loader2, Check } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { resolveButtonColors } from '@/lib/membership-card-colors'
import { MembershipConsentScreen } from '@/components/shared/membership-consent-screen'
import type { ClientMembership, ClientMembershipInterval } from '@/lib/client-memberships'

const INTERVAL_LABEL: Record<ClientMembershipInterval, string> = {
  WEEK: 'week',
  FORTNIGHT: 'fortnight',
  MONTH: 'month',
}

/** "$400.00 / month" for a recurring plan, plain money for a one-off. */
function priceLabel(m: ClientMembership, currency: string): string {
  const base = formatMoney(m.priceCents, currency)
  return m.interval ? `${base} / ${INTERVAL_LABEL[m.interval]}` : base
}

/**
 * The client-facing membership cards + their buy action. Shared by the
 * Memberships storefront page and the Offerings flow's "Memberships" type, so a
 * trainer's card styling (image, colours, custom button text) renders
 * identically wherever a client meets it.
 */
// Plain-language reason a package can't just be bought, shown beside the
// Request button so the client is never left guessing what happened.
const BLOCKED_COPY: Record<'RECURRING' | 'NO_PRICE', string> = {
  RECURRING: 'This one bills you regularly, so it has to be set up for you before you can buy it.',
  NO_PRICE: 'This one doesn’t have a price on it yet.',
}

export function MembershipCards({ memberships, currency }: { memberships: ClientMembership[]; currency: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
          return (
            <div key={m.id} className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ backgroundColor: bg }}>
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className="w-full h-36 object-cover" />
              )}
              <div className="p-5">
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
                {m.subscribed ? (
                  // Already paying for it. Selling it again would stack a second
                  // recurring charge on the same plan.
                  <p className="mt-4 flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
                    <Check className="h-4 w-4" strokeWidth={1.75} /> You&apos;re on this plan
                  </p>
                ) : m.buyable ? (
                  <button
                    onClick={() => (m.needsConsent ? setConsentFor(m.id) : buy(m.id))}
                    disabled={busy === m.id}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: btn.background, color: btn.color }}
                  >
                    {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {m.buttonText?.trim() || (m.needsConsent ? 'Subscribe' : 'Get this package')}
                  </button>
                ) : (
                  <>
                    <p className="mt-4 text-sm" style={{ color: text }}>
                      {BLOCKED_COPY[m.blockedReason ?? 'NO_PRICE']}
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
          onConfirm={(planId) => buy(consenting.id, { consent: true, planId: planId ?? consenting.plans[0]?.id })}
        />
      )}
    </>
  )
}
