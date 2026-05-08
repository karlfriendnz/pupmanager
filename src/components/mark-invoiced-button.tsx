'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, CheckCircle2, Loader2 } from 'lucide-react'

/**
 * Companion to MarkCompleteButton for the second part of the session
 * lifecycle — once the session is COMPLETED (or COMMENTED), the trainer
 * can flag it as INVOICED. This is a status-only flip; PupManager doesn't
 * actually generate the invoice. It's for trainers who handle billing
 * outside the app (Xero/QBO/manual) and want a place to note "I've sent
 * the invoice for this one".
 *
 * Hidden while the session is still UPCOMING — invoicing a session that
 * hasn't happened doesn't make sense.
 */
export function MarkInvoicedButton({
  sessionId,
  initialStatus,
}: {
  sessionId: string
  initialStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [saving, setSaving] = useState(false)

  if (status === 'UPCOMING') return null

  const isInvoiced = status === 'INVOICED'

  async function handleClick() {
    if (isInvoiced || saving) return
    setSaving(true)
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'INVOICED' }),
    })
    if (res.ok) {
      setStatus('INVOICED')
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
