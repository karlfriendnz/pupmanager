'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, CheckCircle2, Loader2 } from 'lucide-react'

/**
 * Toggle the session's invoiced state. Independent of completion — the
 * trainer can invoice a session before OR after they mark it complete,
 * so this button is always visible regardless of `status`. Driven off
 * `invoicedAt` (null = not invoiced; set = invoiced at that timestamp).
 *
 * For trainers who handle billing outside PupManager (Xero/QBO/manual)
 * it's a one-tap "I've sent the invoice" flag. The financial layer keys
 * off this same field once we wire real payments in.
 */
export function MarkInvoicedButton({
  sessionId,
  initialInvoicedAt,
  variant = 'inline',
}: {
  sessionId: string
  initialInvoicedAt: string | Date | null
  variant?: 'inline' | 'stacked'
}) {
  const router = useRouter()
  const [invoicedAt, setInvoicedAt] = useState<string | Date | null>(initialInvoicedAt)
  const [saving, setSaving] = useState(false)

  const isInvoiced = invoicedAt != null
  const stacked = variant === 'stacked'

  async function handleClick() {
    if (isInvoiced || saving) return
    setSaving(true)
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiced: true }),
    })
    if (res.ok) {
      setInvoicedAt(new Date().toISOString())
      router.refresh()
    }
    setSaving(false)
  }

  if (isInvoiced) {
    return (
      <span
        title="Invoiced"
        className={
          stacked
            ? 'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl bg-purple-50 text-purple-700 border border-purple-200'
            : 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-purple-50 text-purple-700 border border-purple-200'
        }
      >
        <CheckCircle2 className={stacked ? 'h-6 w-6' : 'h-4 w-4'} />
        <span className={stacked ? 'text-xs font-medium leading-tight text-center' : ''}>Invoiced</span>
      </span>
    )
  }

  const icon = saving
    ? <Loader2 className={stacked ? 'h-6 w-6 animate-spin text-purple-600' : 'h-4 w-4 animate-spin text-purple-600'} />
    : <Receipt className={stacked ? 'h-6 w-6 text-purple-600' : 'h-4 w-4 text-purple-600'} />

  return (
    <button
      onClick={handleClick}
      disabled={saving}
      title="Mark as invoiced"
      className={
        stacked
          ? 'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-purple-300 hover:bg-purple-50 disabled:opacity-60 transition-colors'
          : 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-purple-300 hover:bg-purple-50 disabled:opacity-60 transition-colors'
      }
    >
      {icon}
      <span className={stacked ? 'text-xs font-medium leading-tight text-center' : ''}>Mark invoiced</span>
    </button>
  )
}
