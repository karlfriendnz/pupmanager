'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Loader2, Receipt } from 'lucide-react'
import { accentIconStyle } from './session-actions'
import { ACTION_BUTTON } from './session-rows'

/**
 * The session screen's actions as FULL-WIDTH buttons, one per row (Karl,
 * 2026-08-08: "a full width button to start notes… a mark as complete full
 * width button, and invoice full width button").
 *
 * Deliberately not a `variant` on the cells in session-actions.tsx: those are
 * cells in a divided strip and these are stacked buttons, and a component that
 * reflows two ways is how the offering card ended up crushing its own title
 * (AGENTS.md — one layout per component). The two share the accent derivation
 * and nothing else.
 *
 * All three read the same: a line icon on the left, the label beside it, the
 * whole row tappable at 56px. No filled colour — the trainer's accent tints the
 * icon only, and a finished action goes quiet rather than green.
 */

/** Shared with the server-side link buttons, so the stack reads as one set. */
const ROW = ACTION_BUTTON

async function patchSession(sessionId: string, body: Record<string, unknown>) {
  return fetch(`/api/schedule/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Mark complete ⇄ undo. Tapping a completed session rolls it back. */
export function CompleteButton({
  sessionId,
  initialStatus,
  accent,
}: {
  sessionId: string
  initialStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
  accent?: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [saving, setSaving] = useState(false)
  const done = status !== 'UPCOMING'

  async function toggle() {
    if (saving) return
    const next = done ? 'UPCOMING' : 'COMPLETED'
    setSaving(true)
    const res = await patchSession(sessionId, { status: next })
    if (res.ok) {
      setStatus(next)
      router.refresh()
    }
    setSaving(false)
  }

  return (
    <button type="button" onClick={toggle} disabled={saving} className={ROW}>
      {saving ? (
        <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Check className="h-5 w-5 flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block ${done ? 'text-slate-400' : ''}`}>
          {done ? 'Completed' : 'Mark as complete'}
        </span>
        {done && <span className="mt-0.5 block text-[13px] font-normal text-slate-400">Tap to undo</span>}
      </span>
    </button>
  )
}

/** One-tap "I've billed this elsewhere" flag. One-way, like the pill version. */
export function InvoiceButton({
  sessionId,
  initialInvoicedAt,
  accent,
}: {
  sessionId: string
  initialInvoicedAt: string | null
  accent?: string | null
}) {
  const router = useRouter()
  const [invoicedAt, setInvoicedAt] = useState(initialInvoicedAt)
  const [saving, setSaving] = useState(false)
  const done = invoicedAt != null

  async function mark() {
    if (done || saving) return
    setSaving(true)
    const res = await patchSession(sessionId, { invoiced: true })
    if (res.ok) {
      setInvoicedAt(new Date().toISOString())
      router.refresh()
    }
    setSaving(false)
  }

  return (
    <button type="button" onClick={mark} disabled={saving || done} className={ROW}>
      {saving ? (
        <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Receipt className="h-5 w-5 flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block ${done ? 'text-slate-400' : ''}`}>{done ? 'Invoiced' : 'Invoice'}</span>
        {done && invoicedAt && (
          <span className="mt-0.5 block text-[13px] font-normal text-slate-400">
            Marked {new Date(invoicedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </span>
    </button>
  )
}
