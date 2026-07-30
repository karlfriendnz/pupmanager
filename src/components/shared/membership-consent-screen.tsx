'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, CalendarClock, RefreshCw, Ban, Check } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import type { ClientMembership } from '@/lib/client-memberships'

// The screen a client sees BEFORE we send them to Stripe to start a recurring
// payment.
//
// A one-off charge needs no ceremony: they clicked, they paid, it is over. This
// is different — we are asking permission to take money from a card while nobody
// is watching, which has to be explicit, specific and recorded. It is also a
// legal requirement in most of our markets (UK/EU SCA, Australian consumer law,
// the NZ Fair Trading Act), and Stripe's own Checkout page is generic: it knows
// nothing about minimum terms or early-finish fees, so it cannot do this for us.
//
// Every sentence here is built SERVER-side by the same function that writes the
// stored consent row, so what is on screen and what we keep on file cannot drift.
export function MembershipConsentScreen({
  membership,
  onCancel,
  onConfirm,
  busy,
  error,
}: {
  membership: ClientMembership
  onCancel: () => void
  /** Receives the chosen billing option, so the route prices what was shown. */
  onConfirm: (planId: string | undefined) => void
  busy: boolean
  error: string | null
}) {
  // Not pre-ticked. An agreement nobody actively made is not an agreement.
  const [agreed, setAgreed] = useState(false)
  // A membership can offer several billing options ($10/wk OR $35/mo). The
  // first is the default, and the same one the buy route falls back to.
  const options = membership.plans
  const [planId, setPlanId] = useState<string | undefined>(options[0]?.id)
  const chosen = options.find(p => p.id === planId) ?? null
  // Each option is its own agreement, so the words follow the choice.
  const consent = chosen?.consent ?? membership.consent

  // Never two scrollbars on screen: lock the page behind this while it is open,
  // and let only the panel's own region scroll.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!consent) return null

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm ${membership.name}`}
        className="fixed inset-0 z-[70] flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-900/40 sm:backdrop-blur-sm sm:p-4"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-2xl sm:border sm:border-slate-200">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 px-3">
            <h2 className="min-w-0 flex-1 pl-1 text-base font-semibold text-slate-900">Confirm your plan</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onCancel}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto no-scrollbar p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            <p className="text-sm text-slate-500">You&apos;re subscribing to</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{membership.name}</p>
            {/* Who is charging them — the TRAINER, not PupManager. Their name is
                what shows up on the client's bank statement. */}
            <p className="mt-2 text-2xl font-semibold text-slate-900">{consent.priceLabel}</p>

            {/* More than one way to pay for the same thing. Only shown when
                there is a genuine choice — a single option is not a choice, and
                a picker with one row is just noise. */}
            {options.length > 1 && (
              <fieldset className="mt-4">
                <legend className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  How often
                </legend>
                <div className="rounded-xl border border-slate-200 bg-white">
                  {options.map(p => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-3 border-t border-slate-100 px-3 py-3 first:border-t-0"
                    >
                      <input
                        type="radio"
                        name="billing-option"
                        value={p.id}
                        checked={planId === p.id}
                        onChange={() => {
                          setPlanId(p.id)
                          // Changing the option changes what they are agreeing
                          // to, so a tick made against the old one no longer
                          // means anything.
                          setAgreed(false)
                        }}
                        className="h-4 w-4 shrink-0 accent-slate-900"
                      />
                      <span className="text-sm font-medium text-slate-900">{p.priceLabel}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 bg-white">
              <Row
                icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
                label="First payment"
                value="Today"
              />
              <Row
                icon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
                label="Next payment"
                value={consent.nextChargeLabel}
              />
              <Row
                icon={<Ban className="h-4 w-4" strokeWidth={1.75} />}
                label="Minimum term"
                value={consent.termLabel}
              />
            </div>

            {consent.earlyTermFeeLabel && (
              <p className="mt-3 text-sm text-slate-700">{consent.earlyTermFeeLabel}</p>
            )}

            {membership.items.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">What you get</p>
                <ul className="rounded-xl border border-slate-200 bg-white">
                  {membership.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2.5 border-t border-slate-100 px-3 py-2.5 first:border-t-0">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />
                      <span className="text-sm text-slate-800">
                        {it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Telling them WHERE to cancel, by name, is the difference between a
                self-serve cancellation and a support email. */}
            <p className="mt-4 text-sm text-slate-600">
              This keeps going until you cancel. {consent.cancelWhereLabel}
            </p>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900"
              />
              {/* The verbatim string stored on the consent row. */}
              <span className="text-sm text-slate-800">{consent.text}</span>
            </label>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div
            className="shrink-0 border-t border-slate-100 p-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <button
              type="button"
              onClick={() => onConfirm(planId)}
              disabled={!agreed || busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Agree &amp; continue to payment
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5 first:border-t-0">
      <span className="flex items-center gap-2 text-sm text-slate-500">
        <span className="text-slate-700">{icon}</span>
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}
