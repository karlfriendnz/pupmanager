'use client'

import { useEffect, useState } from 'react'

// After Stripe redirects back (?paid=1), the invoice only flips to PAID via the
// async Connect webhook. This polls the public status endpoint until it settles,
// then swaps the "confirming…" card for a clear confirmation — so the payer is
// never left unsure. Public/token-only; reflects settlement, never drives it.

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const POLL_INTERVAL_MS = 2000
const POLL_WINDOW_MS = 40_000
const INITIAL_DELAY_MS = 1200 // give the webhook a beat before the first poll

export function PaymentConfirm({
  token,
  currency,
  amountCents,
  initialAmountPaidCents,
}: {
  token: string
  currency: string
  amountCents: number
  initialAmountPaidCents: number
}) {
  const [phase, setPhase] = useState<'pending' | 'confirmed' | 'timeout'>('pending')
  const [paidCents, setPaidCents] = useState(initialAmountPaidCents)
  const [fullyPaid, setFullyPaid] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const start = Date.now()

    async function poll() {
      if (stopped) return
      try {
        const res = await fetch(`/api/pay/${token}/status`, { cache: 'no-store' })
        if (res.ok) {
          const d = await res.json()
          // Settled once PAID, or PARTIAL with more paid than when we landed
          // (this payment reduced the balance).
          const settled =
            d.status === 'PAID' ||
            (d.status === 'PARTIAL' && typeof d.amountPaidCents === 'number' && d.amountPaidCents > initialAmountPaidCents)
          if (settled) {
            setPaidCents(typeof d.amountPaidCents === 'number' ? d.amountPaidCents : amountCents)
            setFullyPaid(d.status === 'PAID' || (typeof d.amountPaidCents === 'number' && d.amountPaidCents >= amountCents))
            setPhase('confirmed')
            stopped = true
            return
          }
        }
      } catch {
        // transient — keep polling within the window
      }
      if (Date.now() - start >= POLL_WINDOW_MS) {
        setPhase('timeout')
        stopped = true
        return
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, INITIAL_DELAY_MS)
    return () => { stopped = true; clearTimeout(timer) }
  }, [token, amountCents, initialAmountPaidCents])

  if (phase === 'confirmed') {
    const balance = Math.max(0, amountCents - paidCents)
    return (
      <div className="rounded-xl bg-emerald-50 px-4 py-5 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white text-lg font-bold">✓</div>
        <p className="mt-2 text-sm font-semibold text-emerald-800">Payment successful — thank you!</p>
        <p className="mt-1 text-xs text-emerald-700">
          {fullyPaid
            ? `${money(amountCents, currency)} paid in full.`
            : `${money(paidCents, currency)} paid — ${money(balance, currency)} remaining.`}
        </p>
      </div>
    )
  }

  if (phase === 'timeout') {
    return (
      <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">
        Thanks! This can take a moment — we’ll email your receipt once it’s confirmed.
      </p>
    )
  }

  return (
    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700" aria-live="polite">
      <span className="inline-block animate-pulse">Confirming your payment…</span>
    </p>
  )
}
