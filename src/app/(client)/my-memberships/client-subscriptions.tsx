'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, RefreshCw, AlertCircle, CreditCard } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import type { ClientSubscription } from '@/lib/client-memberships'

// What the client is currently paying for, and the one place they stop it.
//
// The cancel path is deliberately ONE confirmation screen — no retention offer,
// no "are you sure?" chain. If cancelling is harder than signing up we have
// built a dark pattern, and in the EU/UK and California that is not just rude,
// it is non-compliant.

function formatDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ClientSubscriptions({ subscriptions }: { subscriptions: ClientSubscription[] }) {
  const router = useRouter()
  const [cancelling, setCancelling] = useState<ClientSubscription | null>(null)

  if (subscriptions.length === 0) return null

  return (
    <section className="mb-6">
      <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">Your plans</p>
      <div className="rounded-xl border border-slate-200 bg-white">
        {subscriptions.map(s => {
          const endsOn = formatDay(s.currentPeriodEnd)
          return (
            <div key={s.purchaseId} className="border-t border-slate-100 px-4 py-3 first:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{s.name}</p>
                  {s.priceLabel && <p className="mt-0.5 text-sm text-slate-500">{s.priceLabel}</p>}
                </div>
                {s.status === 'ACTIVE' && !s.cancelAtPeriodEnd && (
                  <button
                    type="button"
                    onClick={() => setCancelling(s)}
                    className="shrink-0 text-sm font-medium text-slate-500 underline underline-offset-2"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* "I cancelled but I still get my sessions until the 14th" and
                  "I'm cut off" are different states and must read differently. */}
              {s.cancelAtPeriodEnd || s.status === 'CANCELLING' ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-slate-600">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />
                  {endsOn
                    ? `Cancelled — you keep this until ${endsOn}, then it won't renew.`
                    : "Cancelled — it won't renew."}
                </p>
              ) : s.pausedReason ? (
                // Access has actually stopped, so this is the most important
                // sentence on the screen: what happened, and how to fix it.
                // Never shaming — most of these are an expired card.
                <div className="mt-2">
                  <p className="flex items-start gap-2 text-sm text-slate-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />
                    <span>
                      {s.pausedReason}
                      {s.cardLast4 && s.status === 'PAST_DUE' ? ` (card ending ${s.cardLast4})` : ''}
                    </span>
                  </p>
                  {s.status === 'PAST_DUE' && (
                    <UpdateCardButton purchaseId={s.purchaseId} label="Update card" />
                  )}
                </div>
              ) : endsOn ? (
                <p className="mt-2 text-sm text-slate-500">Next payment {endsOn}.</p>
              ) : null}

              {/* The bank wants them to authenticate. Nothing here can do it
                  for them — the money does not move until they tap through. */}
              {s.actionRequiredUrl && (
                <a
                  href={s.actionRequiredUrl}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white"
                >
                  Your bank needs you to approve this payment
                </a>
              )}
            </div>
          )
        })}
      </div>

      {cancelling && (
        <CancelScreen
          subscription={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); router.refresh() }}
        />
      )}
    </section>
  )
}

/**
 * The path from "my plan is paused" back to "everything works".
 *
 * Access stops on the first failed payment and most failures are an expired
 * card, so this is the single most valuable button in the whole failure
 * surface. The webhook that completes it retries the outstanding invoice
 * immediately rather than leaving them waiting for Stripe's next attempt.
 */
function UpdateCardButton({ purchaseId, label }: { purchaseId: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/purchases/${purchaseId}/update-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok || !b.url) {
        setError(typeof b.error === 'string' ? b.error : 'Couldn’t start that just now.')
        return
      }
      window.location.href = b.url
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" strokeWidth={1.75} />}
        {label}
      </button>
      {error && <p className="mt-1 text-sm text-rose-700">{error}</p>}
    </>
  )
}

function CancelScreen({
  subscription,
  onClose,
  onDone,
}: {
  subscription: ClientSubscription
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const endsOn = formatDay(subscription.currentPeriodEnd)
  const committedUntil = formatDay(subscription.committedUntil)

  async function confirm() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/purchases/${subscription.purchaseId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof b.error === 'string' ? b.error : 'We couldn’t cancel that just now.')
        return
      }
      onDone()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cancel ${subscription.name}`}
        className="fixed inset-0 z-[70] flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-900/40 sm:backdrop-blur-sm sm:p-4"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-2xl sm:border sm:border-slate-200">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 px-3">
            <h2 className="min-w-0 flex-1 pl-1 text-base font-semibold text-slate-900">Cancel this plan?</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto no-scrollbar p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            <p className="text-lg font-semibold text-slate-900">{subscription.name}</p>

            {/* When it stops — stated as a date, not "at the end of your period". */}
            <p className="mt-3 text-sm text-slate-700">
              {endsOn
                ? `You'll keep your plan until ${endsOn}. After that it won't renew and you won't be charged again.`
                : "Your plan won't renew and you won't be charged again."}
            </p>

            {/* Inside a minimum term — the exact number, BEFORE they confirm. */}
            {committedUntil && (
              <p className="mt-3 text-sm text-slate-700">
                You committed to this until {committedUntil}. Your trainer may ask you for an early-finish fee — we won&apos;t charge it automatically.
              </p>
            )}

            <p className="mt-3 text-sm text-slate-500">
              Sessions you&apos;ve already booked stay booked. Talk to your trainer if you need to change them.
            </p>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div
            className="shrink-0 space-y-2 border-t border-slate-100 p-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancel my plan
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 font-semibold text-slate-700 disabled:opacity-40"
            >
              Keep it
            </button>
            {/* Most people who open a cancel screen are actually trying to fix
                a failed payment. Offering the fix here turns a cancellation
                into a card update. */}
            <UpdateCardButton purchaseId={subscription.purchaseId} label="Update my card instead" />
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
