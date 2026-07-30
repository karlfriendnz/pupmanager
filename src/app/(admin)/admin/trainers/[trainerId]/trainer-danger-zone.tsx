'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2, Ban, RotateCcw, Loader2 } from 'lucide-react'
import { personLabel } from '@/lib/utils'

// Deactivate / reactivate / permanently delete — split out of
// TrainerDetailActions so the page can put it at the very bottom, below the
// day-to-day controls and the notes. Destructive actions shouldn't sit in the
// middle of a page someone scrolls through to read a diary entry.
//
// It carries its own error state and fetch rather than sharing the parent's:
// the only thing they had in common was a helper, and a component whose whole
// job is "the irreversible things" is better off self-contained.
type Props = {
  id: string
  name: string | null
  email: string | null
  deactivatedAt: string | null
}

export function TrainerDangerZone(props: Props) {
  const router = useRouter()
  const isActive = !props.deactivatedAt

  const [error, setError] = useState<string | null>(null)
  const [togglingActive, setTogglingActive] = useState(false)
  const [showHardDelete, setShowHardDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Deleting is gated on typing something you can't hit by accident. That's the
  // email when there is one — but User.email is nullable now, and a null gate
  // is one nobody could ever satisfy, so those accounts confirm on "DELETE".
  const confirmPhrase = props.email?.trim() || 'DELETE'

  async function setActive(active: boolean) {
    setTogglingActive(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/trainers/${props.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to update account')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update account')
    } finally {
      setTogglingActive(false)
    }
  }

  async function handleHardDelete() {
    setDeleting(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${props.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/admin/trainers')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Failed to delete trainer')
      setShowHardDelete(false)
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-rose-400/80 mb-3">Danger zone</h2>
        {error && !showHardDelete && (
          <p className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-2 text-sm text-red-300 mb-3">{error}</p>
        )}
        {isActive ? (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setActive(false)} disabled={togglingActive}
              className="inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200 px-4 h-10 rounded-lg border border-amber-500/40 disabled:opacity-50">
              <Ban className="h-4 w-4" /> {togglingActive ? 'Deactivating…' : 'Deactivate (block sign-in, keep data)'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setActive(true)} disabled={togglingActive}
              className="inline-flex items-center gap-1.5 text-sm text-green-300 hover:text-green-200 px-4 h-10 rounded-lg border border-green-500/40 disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> {togglingActive ? 'Reactivating…' : 'Reactivate account'}
            </button>
            <button onClick={() => { setConfirmText(''); setShowHardDelete(true) }}
              className="inline-flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-4 h-10 rounded-lg">
              <Trash2 className="h-4 w-4" /> Delete permanently
            </button>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-3">
          An account must be deactivated before it can be permanently deleted.
        </p>
      </div>

      {/* Permanent-delete confirmation modal — requires typing the email. */}
      {showHardDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => !deleting && setShowHardDelete(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-950 p-2 text-red-400"><AlertTriangle className="h-5 w-5" /></div>
              <div>
                <h2 className="text-base font-semibold text-white">Permanently delete this account?</h2>
                <p className="text-sm text-slate-400 mt-1">
                  This erases <span className="text-slate-200">{personLabel(props, 'this account')}</span> and all of their data —
                  clients, dogs, sessions, packages, and history.
                  <span className="text-red-300"> This cannot be undone.</span>
                </p>
              </div>
            </div>
            <label className="block text-xs text-slate-400 mt-5 mb-1.5">
              Type <span className="text-slate-200 font-medium select-all">{confirmPhrase}</span> to confirm
            </label>
            <input autoFocus value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={confirmPhrase}
              className="w-full h-10 rounded-lg bg-slate-900 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowHardDelete(false)} disabled={deleting}
                className="text-sm text-slate-300 hover:text-white px-4 h-9 rounded-lg border border-slate-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleHardDelete} disabled={deleting || confirmText.trim() !== confirmPhrase}
                className="inline-flex items-center gap-1.5 text-sm bg-red-600 hover:bg-red-700 text-white px-4 h-9 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
