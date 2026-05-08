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
}: {
  sessionId: string
  initialInvoicedAt: string | Date | null
}) {
  const router = useRouter()
  const [invoicedAt, setInvoicedAt] = useState<string | Date | null>(initialInvoicedAt)
  const [saving, setSaving] = useState(false)

  const isInvoiced = invoicedAt != null

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
      <span className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700">
        <CheckCircle2 className="h-4 w-4" /> Invoiced
      </span>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 transition-colors"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
      Mark as invoiced
    </button>
  )
}
