'use client'

import { useEffect, useState } from 'react'
import { isNative } from '@/lib/native'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'

// One-time "get the app" nudge, shown the first time a client lands on their
// home in the browser. Hidden inside the native app (they already have it) and
// remembered per device so it shows once.
const SEEN_KEY = 'pm_app_prompt_seen'

export function AppInstallModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isNative()) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
    } catch {
      // Private mode / storage blocked — just skip the prompt rather than
      // risk showing it on every load.
      return
    }
    // One-time mount gate — intentional state set in effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true)
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // ignore — closing is more important than remembering
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Get the app"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl" aria-hidden>🎉</div>
        <h2 className="mt-2 text-xl font-bold text-slate-900">You&apos;re all set!</h2>
        <p className="mt-1 text-sm text-slate-600">
          Get the app to follow your dog&apos;s training, message your trainer, and get
          session reminders — wherever you are.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={dismiss} aria-label="Download on the App Store">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/app-store-badge.png" alt="Download on the App Store" className="h-11 w-auto" />
          </a>
          <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={dismiss} aria-label="Get it on Google Play">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/google-play-badge.png" alt="Get it on Google Play" className="h-11 w-auto" />
          </a>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mt-5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
