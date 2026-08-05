'use client'

import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { TRY_CONVERT_COPY } from '@/lib/demo-consent'

/**
 * The strip a trade-show visitor sees while they are inside a sandbox.
 *
 * Four jobs, in order of how much they matter:
 *
 * 1. TELL THEM IT IS A DEMO. Somebody is about to type a real client's name
 *    into this. The bar says, on every screen, that it is practice data and
 *    that it goes away.
 * 2. LET THEM BUY. "Start my own account" sits here, on every screen, and not
 *    only on the thanks-for-looking page — somebody who is sold at minute three
 *    should not have to find the exit first.
 * 3. KEEP IT ALIVE while they are using it. The ping is what makes the idle
 *    timeout mean anything — without it every sandbox looks abandoned the
 *    moment it is made.
 * 4. LET THEM FINISH. The exit button destroys the workspace immediately, so
 *    the next person at the stand does not pick up the phone and find
 *    somebody else's business.
 *
 * Rendered only when the session carries the signed `isDemo` flag, which is
 * stamped server-side from the tenant's marker column. This component cannot
 * make a session a demo — it only reports one.
 */
export function DemoSessionBar({ expiresAt }: { expiresAt: string | null }) {
  const [ending, setEnding] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Countdown to the hard expiry. Purely informational — the sweep is what
  // actually ends it, and it is authoritative.
  useEffect(() => {
    if (!expiresAt) return
    const end = new Date(expiresAt).getTime()
    const tick = () => setRemaining(Math.max(0, end - Date.now()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [expiresAt])

  // Heartbeat, but only while the tab is actually on screen. A phone in a
  // pocket is an abandoned sandbox, and pinging from a hidden tab is how a
  // stand ends up with forty live tenants at closing time.
  useEffect(() => {
    let cancelled = false
    const ping = () => {
      if (cancelled || document.visibilityState !== 'visible') return
      fetch('/api/try/heartbeat', { method: 'POST' }).catch(() => {})
    }
    ping()
    const id = setInterval(ping, 2 * 60_000)
    document.addEventListener('visibilitychange', ping)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [])

  // Karl's standing rule: never two scrollbars. The confirm screen covers the
  // page, so the page behind it must not scroll for as long as it is open.
  useEffect(() => {
    if (!confirmOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [confirmOpen])

  const finish = useCallback(async () => {
    setEnding(true)
    // Destroy the tenant first, then drop the session. The other order leaves a
    // sandbox standing with nobody signed into it until the sweep comes round.
    await fetch('/api/try/exit', { method: 'POST' }).catch(() => {})
    await signOut({ callbackUrl: '/try/finished' })
  }, [])

  const convert = useCallback(async () => {
    setConverting(true)
    // Same order, and for a sharper reason: they are signed in as a demo
    // trainer right now. Going to /register holding that session either bounces
    // them or half-associates the new account with a tenant that is about to be
    // deleted. So the server ends the demo and destroys the tenant, and only
    // then does the browser sign out and navigate.
    await fetch('/api/try/convert', { method: 'POST' }).catch(() => {})
    // `as=pro` skips the "are you a trainer or a dog owner" chooser: they
    // already told us which trade they are when they picked a persona.
    await signOut({ callbackUrl: '/register?as=pro&from=try' })
  }, [])

  const minutes = remaining === null ? null : Math.ceil(remaining / 60_000)
  const busy = ending || converting

  return (
    <>
      <div
        data-review-scope="Demo session bar"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-xs"
      >
        <FlaskConical className="h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="font-medium text-slate-900">Demo — practice data only</span>
        {minutes !== null && (
          <span className="text-slate-500">
            {minutes > 0 ? `about ${minutes} min left` : 'finishing up'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* The way out that leads somewhere, so it reads as the primary of
              the two. Someone who has decided should not have to find "Finish"
              first and hope for an offer on the far side. */}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-semibold text-white transition-colors active:bg-slate-800 disabled:opacity-60"
          >
            {TRY_CONVERT_COPY.action}
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-900 transition-colors active:bg-slate-50 disabled:opacity-60"
          >
            {ending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
            Finish demo
          </button>
        </div>
        <p className="w-full text-slate-500">
          Nothing here is real and nothing can be emailed to anyone. Everything is deleted when you finish.
        </p>
      </div>

      {confirmOpen && (
        // A full screen, not a 56px menu hanging off a corner: this is the
        // moment somebody decides to buy, and it deserves room to say plainly
        // what they are about to lose. Portalled to <body> because the mobile
        // header uses backdrop-blur, and a filtered ancestor becomes the
        // containing block for position: fixed.
        <ModalPortal>
          <div
            data-review-scope="Start my own account — confirm"
            className="fixed inset-0 z-50 flex flex-col bg-white"
          >
            <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-8">
              <div className="mx-auto flex w-full max-w-md flex-col gap-5">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {TRY_CONVERT_COPY.title}
                </h2>

                {/* The sentence that must not be buried. First thing under the
                    title, full size, no expander to open. */}
                <p className="text-base leading-relaxed text-slate-900">
                  {TRY_CONVERT_COPY.warning}
                </p>

                <p className="text-sm leading-relaxed text-slate-600">
                  {TRY_CONVERT_COPY.reassurance}
                </p>
              </div>
            </div>

            {/* Pinned action bar — a phone's thumb is at the bottom of the
                screen, not the top. */}
            <div className="border-t border-slate-200 px-5 py-4">
              <div className="mx-auto flex w-full max-w-md flex-col gap-2">
                <button
                  type="button"
                  onClick={convert}
                  disabled={converting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                >
                  {converting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
                  {TRY_CONVERT_COPY.confirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={converting}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3.5 text-sm font-semibold text-slate-900 transition-colors active:bg-slate-50 disabled:opacity-60"
                >
                  {TRY_CONVERT_COPY.cancel}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
