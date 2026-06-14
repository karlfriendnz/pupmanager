'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FlaskConical, Loader2, Sparkles } from 'lucide-react'

// Strip at the bottom of the dashboard while sample data is loaded. "Remove"
// clears only the tagged sample rows — anything real the trainer added stays —
// so it's the "I'm ready to set up for real" off-ramp.
//
// Once the trainer has 3+ REAL clients the banner escalates to a stronger
// "you're up and running — clear the demo data" nudge (per the onboarding
// brief's "auto-prompt to remove after first 3 real clients"). It's still just
// a prompt — never auto-deletes; some trainers like keeping the reference.
const REAL_CLIENT_PROMPT_THRESHOLD = 3

export function SampleDataBanner({ realClientCount = 0 }: { realClientCount?: number }) {
  const router = useRouter()
  const [clearing, setClearing] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const nudge = realClientCount >= REAL_CLIENT_PROMPT_THRESHOLD

  async function clear() {
    setClearing(true)
    const res = await fetch('/api/trainer/sample-data/clear', { method: 'POST' })
    if (res.ok) router.refresh()
    setClearing(false)
    setConfirm(false)
  }

  // Escalated styling/copy once they've added real clients.
  const wrap = nudge
    ? 'border-emerald-200 bg-emerald-50'
    : 'border-amber-200 bg-amber-50'
  const Icon = nudge ? Sparkles : FlaskConical
  const iconColor = nudge ? 'text-emerald-600' : 'text-amber-600'
  const textColor = nudge ? 'text-emerald-900' : 'text-amber-900'
  const message = nudge
    ? `You've added ${realClientCount} real clients — ready to clear the sample data?`
    : "You're exploring with sample data"
  const btnIdle = nudge
    ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
    : 'border-amber-300 text-amber-800 hover:bg-amber-100'
  const btnConfirm = nudge ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
  const cancelColor = nudge ? 'text-emerald-700 hover:text-emerald-900' : 'text-amber-700 hover:text-amber-900'

  return (
    <div className={`mb-6 flex items-center gap-3 rounded-2xl border px-4 py-3 ${wrap}`}>
      <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
      <p className={`flex-1 min-w-0 truncate text-sm font-medium ${textColor}`}>{message}</p>
      {confirm ? (
        <span className="flex shrink-0 items-center gap-2">
          <button
            onClick={clear}
            disabled={clearing}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold text-white transition-colors disabled:opacity-60 ${btnConfirm}`}
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Yes, remove
          </button>
          <button onClick={() => setConfirm(false)} disabled={clearing} className={`px-2 h-8 text-xs font-medium ${cancelColor}`}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className={`shrink-0 rounded-lg border bg-white px-3 h-8 text-xs font-semibold transition-colors ${btnIdle}`}
        >
          Remove sample data
        </button>
      )}
    </div>
  )
}
