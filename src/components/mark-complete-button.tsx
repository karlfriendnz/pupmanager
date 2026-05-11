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
  variant = 'inline',
}: {
  sessionId: string
  initialStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
  // `inline` = pill with icon + label on one line (the default).
  // `stacked` = larger square tile with icon on top, label below — used
  // on the session detail page so the primary actions are big tap
  // targets on phones.
  variant?: 'inline' | 'stacked'
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

  const stacked = variant === 'stacked'

  if (isComplete) {
    const label = saving ? 'Updating' : hovering ? 'Mark not complete' : 'Completed'
    const icon = saving
      ? <Loader2 className={stacked ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} />
      : hovering
        ? <Undo2 className={stacked ? 'h-6 w-6' : 'h-4 w-4'} />
        : <CheckCircle2 className={stacked ? 'h-6 w-6' : 'h-4 w-4'} />
    return (
      <button
        onClick={() => !saving && setRemote('UPCOMING')}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        disabled={saving}
        title={label}
        className={
          stacked
            ? 'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-60 transition-colors'
            : 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-60 transition-colors'
        }
      >
        {icon}
        <span className={stacked ? 'text-xs font-medium leading-tight text-center' : ''}>{label}</span>
      </button>
    )
  }

  const icon = saving
    ? <Loader2 className={stacked ? 'h-6 w-6 animate-spin text-green-600' : 'h-4 w-4 animate-spin text-green-600'} />
    : <Check className={stacked ? 'h-6 w-6 text-green-600' : 'h-4 w-4 text-green-600'} />

  return (
    <button
      onClick={() => !saving && setRemote('COMPLETED')}
      disabled={saving}
      title="Mark as complete"
      className={
        stacked
          ? 'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-green-300 hover:bg-green-50 disabled:opacity-60 transition-colors'
          : 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-green-300 hover:bg-green-50 disabled:opacity-60 transition-colors'
      }
    >
      {icon}
      <span className={stacked ? 'text-xs font-medium leading-tight text-center' : ''}>Mark complete</span>
    </button>
  )
}
