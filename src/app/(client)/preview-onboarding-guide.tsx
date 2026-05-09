'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const DISMISS_KEY = 'pm-preview-guide-dismissed'

// Shown beneath the "Previewing as …" amber banner the first time a trainer
// in onboarding lands on /preview-as. Frames the preview ("this is what your
// client sees") and points the trainer at the indigo nav dots that highlight
// each section the client has access to. SessionStorage-backed dismiss so
// it stays out of the way after the trainer says 'Got it'.
export function PreviewOnboardingGuide() {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  if (!mounted || dismissed) return null

  return (
    <div className="relative mx-3 mt-3 mb-1 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-4 text-white shadow-[0_10px_30px_-8px_rgba(99,102,241,0.55)]">
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1')
          setDismissed(true)
        }}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
        You&apos;re seeing the client view
      </p>
      <p className="mt-1.5 text-sm leading-snug text-white pr-8">
        This is exactly what your client sees when they log in. Look for the
        <span className="inline-block h-2 w-2 rounded-full bg-white align-middle ring-2 ring-white/40 mx-1" />
        indigo dots in the nav — each one points at a section your client can use (sessions, profile, shop, and more).
      </p>
      <p className="mt-2 text-sm leading-snug text-white/90 pr-8">
        Once you&apos;re happy, click <span className="font-semibold">Exit preview</span> in the top-right to go back to your dashboard.
      </p>
    </div>
  )
}
