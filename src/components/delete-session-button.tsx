'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, X } from 'lucide-react'

/**
 * Destructive action button for the session detail page. First click reveals
 * an inline confirm prompt — no full-screen modal — so the trainer doesn't
 * accidentally nuke a session by tapping a tiny icon. On confirm, hits
 * DELETE /api/schedule/[id] and routes back to the client tab they came from
 * (or /schedule as a fallback).
 */
export function DeleteSessionButton({
  sessionId,
  redirectTo,
}: {
  sessionId: string
  /** Where to send the trainer after a successful delete. */
  redirectTo?: string
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
      router.push(redirectTo ?? '/schedule')
      router.refresh()
      return
    }
    setError('Could not delete this session — try again.')
    setDeleting(false)
    setConfirming(false)
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        title="Delete session"
      >
        <Trash2 className="h-4 w-4" />
        <span className="hidden sm:inline">Delete</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-600 hidden sm:inline">Delete this session?</span>
        <button
          onClick={() => { setConfirming(false); setError(null) }}
          disabled={deleting}
          aria-label="Cancel"
          className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Yes, delete
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
