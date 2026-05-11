'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Eye, Trash2, Loader2 } from 'lucide-react'

// Overflow menu for the session detail header. Holds the secondary
// actions (Preview, Delete) so the page's primary buttons (Mark
// complete, Mark invoiced) get room to be big icon-on-top tap targets.
export function SessionMoreMenu({
  sessionId,
  redirectTo,
}: {
  sessionId: string
  redirectTo: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onPointer(ev: MouseEvent | TouchEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(ev.target as Node)) {
        setOpen(false)
        setConfirmingDelete(false)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        setOpen(false)
        setConfirmingDelete(false)
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
    setConfirmingDelete(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl bg-white shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)] border border-slate-100 overflow-hidden"
        >
          {!confirmingDelete ? (
            <>
              <Link
                href={`/sessions/${sessionId}/preview`}
                role="menuitem"
                className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Eye className="h-4 w-4 text-purple-600 flex-shrink-0" />
                Preview report
              </Link>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                role="menuitem"
                className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-rose-600 hover:bg-rose-50 border-t border-slate-100"
              >
                <Trash2 className="h-4 w-4 flex-shrink-0" />
                Delete session
              </button>
            </>
          ) : (
            <div className="p-3">
              <p className="text-sm font-medium text-slate-900 mb-1">Delete this session?</p>
              <p className="text-xs text-slate-500 mb-3">This cannot be undone.</p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setConfirmingDelete(false); setError(null) }}
                  disabled={deleting}
                  className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              </div>
              {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
