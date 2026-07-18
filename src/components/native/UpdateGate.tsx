'use client'

import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { openExternal } from '@/lib/external-link'
import {
  evaluateUpdate,
  type Platform,
  type UpdateStatus,
  type VersionRequirements,
} from '@/lib/app-version'

// Native-only update gate. On launch (and whenever the app returns to the
// foreground) it reads the running build's version and compares it against the
// floor served by /api/app/version-requirements:
//   • blocked → full-screen, non-dismissable "Update required" wall.
//   • nudge   → dismissable banner pinned to the bottom.
//   • ok      → renders nothing.
//
// Web / PWA sessions never mount any of this (isNativePlatform() is false), and
// any failure to fetch/parse the config leaves status at 'ok' so a flaky check
// can never lock a user out of their own app.
export function UpdateGate() {
  const [status, setStatus] = useState<UpdateStatus>('ok')
  const [storeUrl, setStoreUrl] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const platform = Capacitor.getPlatform()
    if (platform !== 'ios' && platform !== 'android') return

    let cancelled = false

    async function check() {
      try {
        const [info, res] = await Promise.all([
          CapacitorApp.getInfo(),
          fetch('/api/app/version-requirements', { cache: 'no-store' }),
        ])
        if (cancelled || !res.ok) return
        const reqs = (await res.json()) as VersionRequirements
        const req = reqs[platform as Platform]
        if (cancelled || !req) return
        setStoreUrl(req.storeUrl)
        setStatus(evaluateUpdate(info.version, req))
      } catch {
        // A version check must never break the app — leave status untouched.
      }
    }

    void check()

    // Re-check on foreground: the user may have just come back from the store
    // after updating, so clear a prior dismissal and re-evaluate.
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        setDismissed(false)
        void check()
      }
    })

    return () => {
      cancelled = true
      void handle.then((h) => h.remove())
    }
  }, [])

  if (status === 'ok') return null
  if (status === 'nudge' && dismissed) return null

  const blocked = status === 'blocked'

  if (blocked) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-gate-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm"
      >
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-2xl">
            🐾
          </div>
          <h2 id="update-gate-title" className="text-lg font-semibold text-slate-900">
            Update required
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This version of PupManager is out of date. Please update to the latest
            version to keep using the app.
          </p>
          <button
            type="button"
            onClick={() => openExternal(storeUrl)}
            className="mt-6 w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            Update now
          </button>
        </div>
      </div>
    )
  }

  // Soft nudge — dismissable bottom banner.
  return (
    <div
      role="dialog"
      aria-labelledby="update-nudge-title"
      className="fixed inset-x-0 bottom-0 z-[100] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
        <div className="min-w-0 flex-1">
          <p id="update-nudge-title" className="text-sm font-semibold">
            Update available
          </p>
          <p className="text-xs text-slate-300">A newer version of PupManager is ready.</p>
        </div>
        <button
          type="button"
          onClick={() => openExternal(storeUrl)}
          className="shrink-0 rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-400"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
