'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FlaskConical, Loader2 } from 'lucide-react'

// One-line strip at the bottom of the dashboard while sample data is loaded.
// "Remove" clears only the tagged sample rows — anything real the trainer added
// stays — so it's the "I'm ready to set up for real" off-ramp.
export function SampleDataBanner() {
  const router = useRouter()
  const [clearing, setClearing] = useState(false)
  const [confirm, setConfirm] = useState(false)

  async function clear() {
    setClearing(true)
    const res = await fetch('/api/trainer/sample-data/clear', { method: 'POST' })
    if (res.ok) router.refresh()
    setClearing(false)
    setConfirm(false)
  }

  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <FlaskConical className="h-5 w-5 shrink-0 text-amber-600" />
      <p className="flex-1 min-w-0 truncate text-sm font-medium text-amber-900">You&apos;re exploring with sample data</p>
      {confirm ? (
        <span className="flex shrink-0 items-center gap-2">
          <button
            onClick={clear}
            disabled={clearing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 h-8 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Yes, remove
          </button>
          <button onClick={() => setConfirm(false)} disabled={clearing} className="px-2 h-8 text-xs font-medium text-amber-700 hover:text-amber-900">
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 h-8 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
        >
          Remove sample data
        </button>
      )}
    </div>
  )
}
