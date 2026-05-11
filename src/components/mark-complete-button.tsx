'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Loader2, Undo2 } from 'lucide-react'

/**
 * Toggle the session's completion status. UPCOMING ↔ COMPLETED via PATCH
 * /api/schedule/[id]. Once marked complete, the button switches to a green
 * confirmed pill — clicking it again rolls the status back to UPCOMING so
 * the trainer can correct an accidental tap.
 *
 * Only the COMPLETED ↔ UPCOMING edge is exposed here. COMMENTED and
 * INVOICED are managed elsewhere (form responses + invoice button).
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
  const [hovering, setHovering] = useState(false)

  const isComplete = status !== 'UPCOMING'

  async function setRemote(next: 'UPCOMING' | 'COMPLETED') {
    setSaving(true)
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) {
      setStatus(next)
      router.refresh()
    }
    setSaving(false)
  }

  if (isComplete) {
    // Hover-swap the icon: shows a check at rest, undo when hovered, so the
    // trainer sees the affordance before clicking. Click rolls back to
    // UPCOMING so they can correct an accidental complete.
    return (
      <button
        onClick={() => !saving && setRemote('UPCOMING')}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        disabled={saving}
        title={saving ? 'Updating' : hovering ? 'Mark not complete' : 'Completed'}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-60 transition-colors"
      >
        {saving
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : hovering
            ? <Undo2 className="h-4 w-4" />
            : <CheckCircle2 className="h-4 w-4" />}
        <span className="hidden sm:inline">
          {saving ? 'Updating' : hovering ? 'Mark not complete' : 'Completed'}
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={() => !saving && setRemote('COMPLETED')}
      disabled={saving}
      title="Mark as complete"
      className="inline-flex items-center gap-1.5 text-sm font-medium px-2 sm:px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      <span className="hidden sm:inline">Mark as complete</span>
    </button>
  )
}
