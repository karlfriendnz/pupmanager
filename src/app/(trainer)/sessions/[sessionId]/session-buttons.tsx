'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Loader2, Receipt } from 'lucide-react'
import { accentIconStyle } from './session-actions'

/**
 * Closing a session off: mark it invoiced, mark it complete.
 *
 * They started as standalone full-width buttons (Karl asked for exactly that)
 * and became rows in a "Finishing up" block once the screen had six identical
 * white buttons and no shape to it. Same job, grouped with its own kind.
 *
 * Deliberately not a `variant` on the cells in session-actions.tsx: those are
 * cells in a divided strip and a component that reflows two ways is how the
 * offering card ended up crushing its own title (AGENTS.md — one layout per
 * component). The two share the accent derivation and nothing else.
 *
 * No filled colour — the trainer's accent tints the icon only, and a finished
 * action goes quiet rather than green.
 */

/**
 * These are ROWS in a bordered block now, not standalone buttons — the
 * finishing-off actions belong together and the house style puts related
 * things in ONE block split by hairlines (AGENTS.md). Same paddings as the
 * server-side LinkRow beside them.
 */
const ROW = 'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60'

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
        <Loader2 className="h-[18px] w-[18px] flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-[18px] w-[18px] flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Check className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${done ? 'text-slate-400' : 'text-slate-900'}`}>
          {done ? 'Completed' : 'Mark as complete'}
        </span>
        {/* Completing publishes the write-up and tells the client, which is
            not something a trainer should discover by doing it. */}
        <span className={`mt-0.5 block text-[13px] font-normal ${done ? 'text-slate-400' : 'text-slate-500'}`}>
          {done ? 'Tap to undo' : 'Sends your notes to the client'}
        </span>
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
        <Loader2 className="h-[18px] w-[18px] flex-shrink-0 animate-spin text-slate-400" strokeWidth={1.75} />
      ) : done ? (
        <CheckCircle2 className="h-[18px] w-[18px] flex-shrink-0 text-slate-400" strokeWidth={1.75} />
      ) : (
        <Receipt className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${done ? 'text-slate-400' : 'text-slate-900'}`}>{done ? 'Invoiced' : 'Invoice'}</span>
        {done && invoicedAt && (
          <span className="mt-0.5 block text-[13px] font-normal text-slate-400">
            Marked {new Date(invoicedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </span>
    </button>
  )
}
