'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FlaskConical, Loader2 } from 'lucide-react'

// Shown on the dashboard whenever the trainer has loaded sample data. The
// "Remove" action clears ONLY the tagged sample rows — anything real they've
// added stays — so it's the natural "I'm ready to set up for real" off-ramp.
export function SampleDataBanner({ count }: { count: number }) {
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
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
        <FlaskConical className="h-5 w-5" />
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-amber-900">You&apos;re exploring with sample data</h3>
        <p className="text-sm text-amber-800/80 mt-0.5">
          {count} sample client{count !== 1 ? 's' : ''} and demo content are loaded so you can try things out.
          Remove it when you&apos;re ready to set up for real — anything you&apos;ve added yourself stays.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {confirm ? (
            <>
              <button
                onClick={clear}
                disabled={clearing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 h-8 transition-colors disabled:opacity-60"
              >
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Yes, remove sample data
              </button>
              <button
                onClick={() => setConfirm(false)}
                disabled={clearing}
                className="text-xs font-medium text-amber-700 hover:text-amber-900 px-2 h-8"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 text-xs font-semibold px-3 h-8 transition-colors"
            >
              Remove sample data
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
