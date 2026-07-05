'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Client actions for the Payments panel. The heavy lifting (account create,
// link minting) is server-side; these just call the route and hand off to the
// Stripe-hosted URL it returns.

/** Starts or resumes Stripe Connect onboarding, then redirects to Stripe. */
export function ConnectButton({ label, size = 'md', fullWidth = false }: { label: string; size?: 'sm' | 'md' | 'lg'; fullWidth?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/connect/account', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setError(typeof body.error === 'string' ? body.error : 'Could not start payment setup.')
        setLoading(false)
        return
      }
      window.location.href = body.url
    } catch {
      setError('Could not start payment setup.')
      setLoading(false)
    }
  }

  return (
    <div className={fullWidth ? 'w-full' : undefined}>
      <Button type="button" onClick={start} loading={loading} size={size} className={cn(fullWidth && 'w-full')}>{label}</Button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  )
}

/** Full refund of a single payment. */
export function RefundButton({ paymentId, onRefunded }: { paymentId: string; onRefunded?: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refund() {
    if (!confirm('Refund this payment in full? The money is returned to the client.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/trainer/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        if (onRefunded) onRefunded()
        else router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not refund.')
      }
    } catch {
      setError('Could not refund.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={refund} disabled={busy} className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50">
        {busy ? 'Refunding…' : 'Refund'}
      </button>
      {error && <span className="mt-0.5 text-[10px] text-rose-500">{error}</span>}
    </span>
  )
}

/** Toggle a single boolean field on the connect account via PATCH. */
function ConnectToggle({ initial, field, label }: { initial: boolean; field: 'acceptPaymentsEnabled' | 'passProcessingFeeToClient'; label: string }) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !on
    setSaving(true)
    setOn(next) // optimistic
    try {
      const res = await fetch('/api/connect/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      })
      if (!res.ok) setOn(!next) // revert
      else router.refresh()
    } catch {
      setOn(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={saving}
      onClick={toggle}
      // minHeight inline: the app's global `button { min-height:44px }` is
      // unlayered, so it beats Tailwind's layered min-h-* by cascade layer.
      style={{ minHeight: 0 }}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${on ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-300'}`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow" />
    </button>
  )
}

/**
 * Toggle `autoSendInvoices` on the trainer profile. Unlike the Connect toggles
 * this saves via the general trainer-profile PATCH route (the setting is
 * independent of Stripe — it also governs bank-transfer / Xero-only invoicing).
 */
export function AutoSendInvoicesToggle({ initial }: { initial: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !on
    setSaving(true)
    setOn(next) // optimistic
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSendInvoices: next }),
      })
      if (!res.ok) setOn(!next) // revert
      else router.refresh()
    } catch {
      setOn(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Send invoices automatically"
      disabled={saving}
      onClick={toggle}
      style={{ minHeight: 0 }}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${on ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-300'}`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow" />
    </button>
  )
}

/**
 * Toggle `defaultRequirePayment` on the trainer profile — the default answer to
 * "must clients pay up front to book?" for priced packages/classes/products that
 * are left on "Use my default". Saved via the general trainer-profile PATCH.
 */
export function DefaultRequirePaymentToggle({ initial }: { initial: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !on
    setSaving(true)
    setOn(next) // optimistic
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRequirePayment: next }),
      })
      if (!res.ok) setOn(!next) // revert
      else router.refresh()
    } catch {
      setOn(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Require payment to book by default"
      disabled={saving}
      onClick={toggle}
      style={{ minHeight: 0 }}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${on ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-300'}`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow" />
    </button>
  )
}

/** Master switch: only enabled once the account can take charges. */
export function AcceptPaymentsToggle({ initial }: { initial: boolean }) {
  return <ConnectToggle initial={initial} field="acceptPaymentsEnabled" label="Accept payments" />
}

/** When on, the card fee is added on top of the price for the client to pay. */
export function PassFeeToggle({ initial }: { initial: boolean }) {
  return <ConnectToggle initial={initial} field="passProcessingFeeToClient" label="Pass card fees to clients" />
}
