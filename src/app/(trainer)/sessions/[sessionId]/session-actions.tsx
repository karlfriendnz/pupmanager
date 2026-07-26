'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Loader2, Receipt, Trash2 } from 'lucide-react'

/**
 * The session screen's own actions, shaped as parts of the flat block rather
 * than as floating cards.
 *
 * The shared MarkCompleteButton / MarkInvoicedButton still serve the schedule
 * and client screens as pills; this screen needs the same two edges rendered as
 * CELLS in a hairline-divided strip, so they live here instead of adding a
 * third `variant` to a component two other pages depend on (AGENTS.md: one
 * layout per component — let the container be responsive, not the component).
 *
 * Colour rules, per AGENTS.md: no decorative colour. Icons are plain line icons
 * tinted with the trainer's own accent, derived with color-mix toward #0f172a
 * so a pastel brand stays legible. Destructive text is the one exception.
 */

const CELL =
  'flex min-h-[52px] items-center justify-center gap-2 px-2 py-3 text-[13px] font-medium text-slate-900 active:bg-slate-50 disabled:opacity-60'

/** Same derivation the shared flat-list primitives use for row icons. */
export function accentIconStyle(accent?: string | null) {
  return accent ? { color: `color-mix(in srgb, ${accent} 78%, #0f172a)` } : undefined
}

async function patchSession(sessionId: string, body: Record<string, unknown>) {
  return fetch(`/api/schedule/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Mark complete ⇄ undo. Tapping a completed session rolls it back. */
export function CompleteCell({
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
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      title={done ? 'Tap to mark not complete' : 'Mark as complete'}
      className={CELL}
    >
      {saving ? (
        <Loader2 className="h-[18px] w-[18px] flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-[18px] w-[18px] flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Check
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={accentIconStyle(accent)}
          strokeWidth={1.75}
        />
      )}
      <span className={done ? 'text-slate-400' : undefined}>{done ? 'Completed' : 'Complete'}</span>
    </button>
  )
}

/** One-tap "I've billed this elsewhere" flag. One-way, like the pill version. */
export function InvoicedCell({
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
    <button
      type="button"
      onClick={mark}
      disabled={saving || done}
      title={done ? 'Invoiced' : 'Mark as invoiced'}
      className={CELL}
    >
      {saving ? (
        <Loader2 className="h-[18px] w-[18px] flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-[18px] w-[18px] flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Receipt
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={accentIconStyle(accent)}
          strokeWidth={1.75}
        />
      )}
      <span className={done ? 'text-slate-400' : undefined}>{done ? 'Invoiced' : 'Invoice'}</span>
    </button>
  )
}

/**
 * Delete, as the last row on the page — quiet red text, never a filled button,
 * and it always asks first. Confirmation happens IN the row (no overlay, so no
 * second scrollbar and nothing to portal).
 */
export function DeleteSessionRow({
  sessionId,
  redirectTo,
}: {
  sessionId: string
  redirectTo: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setError(null)
    setDeleting(true)
    const res = await fetch(`/api/schedule/${sessionId}`, { method: 'DELETE' })
    if (res.ok) {
      router.push(redirectTo)
      router.refresh()
      return
    }
    setError('Could not delete — try again.')
    setDeleting(false)
    setConfirming(false)
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-rose-50/60"
      >
        <Trash2 className="h-[18px] w-[18px] flex-shrink-0 text-rose-600" strokeWidth={1.75} />
        <span className="flex-1 text-sm font-medium text-rose-600">Delete session</span>
      </button>
    )
  }

  return (
    <div className="px-4 py-3.5">
      <p className="text-sm font-medium text-slate-900">Delete this session?</p>
      <p className="mt-0.5 text-[13px] text-slate-500">This cannot be undone.</p>
      {error && <p className="mt-2 text-[13px] text-rose-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-sm font-medium text-rose-600 active:bg-rose-50 disabled:opacity-60"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" strokeWidth={1.75} />}
          Delete
        </button>
        <button
          type="button"
          onClick={() => { setConfirming(false); setError(null) }}
          disabled={deleting}
          className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-slate-600 active:bg-slate-50 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
