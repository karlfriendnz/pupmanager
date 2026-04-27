'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Loader2 } from 'lucide-react'

/**
 * Single-tap button to flip a session's status to COMPLETED. Uses the existing
 * PATCH /api/schedule/[id] endpoint. Once completed, swaps to a confirmed
 * affordance (no further action) — the trainer can re-open via the schedule
 * if needed.
 */
export function MarkCompleteButton({
  sessionId,
  initialStatus,
}: {
  sessionId: string
  initialStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [saving, setSaving] = useState(false)

  const isComplete = status !== 'UPCOMING'

  async function handleClick() {
    if (isComplete || saving) return
    setSaving(true)
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    })
    if (res.ok) {
      setStatus('COMPLETED')
      router.refresh()
    }
    setSaving(false)
  }

  if (isComplete) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700">
        <CheckCircle2 className="h-4 w-4" /> Completed
      </span>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={saving}
      className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      Mark as complete
    </button>
  )
}
