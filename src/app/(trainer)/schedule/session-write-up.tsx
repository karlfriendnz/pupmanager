'use client'

import { useEffect, useState } from 'react'
import { SessionFormReport } from '@/components/session-form-report'

type PrevEntry = { label: string | null; value: string; italic: boolean }
type PrevSession = { id: string; title: string; scheduledAt: string; entries: PrevEntry[] }

/**
 * The write-up half of the calendar's session popover — what a trainer needs
 * DURING a 1:1, in the order they need it.
 *
 * Karl, 2026-08-08: "a one on one session shows two tabs, the first tab is the
 * details of the dog and the owner, which should only take up a third of the
 * screen, and then below that should be the previous notes button. And then
 * below that should be a form for the session notes."
 *
 * So: who's in front of you, what you wrote last time, then the form. The
 * popover's other tab keeps what it always had — status, dog, time, offering —
 * which is editing the booking, a different job from running the session.
 *
 * Previous notes are FETCHED rather than passed in: the popover is a client
 * component that only knows the session it was opened on, and the calendar
 * holds hundreds of sessions. Loading five write-ups for every one of them up
 * front would be a page of queries for a panel almost none of them will open.
 */
export function SessionWriteUp({
  sessionId,
  sessionStatus,
  view,
}: {
  sessionId: string
  sessionStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
  /** Which tab is showing — the two share one fetch and one mount. */
  view: 'notes' | 'previous'
}) {
  const [prev, setPrev] = useState<PrevSession[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Fetched the first time the Previous tab is looked at, and kept. Switching
  // back and forth must not re-ask the server for something that cannot have
  // changed while the popover was open.
  useEffect(() => {
    if (view !== 'previous' || prev !== null || failed) return
    let live = true
    fetch(`/api/sessions/${sessionId}/previous`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(d => { if (live) setPrev(d.items ?? []) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [view, prev, failed, sessionId])

  if (view === 'previous') {
    return (
      <div className="flex flex-col gap-3">
        {failed ? (
          <p className="text-[13px] text-red-600">Could not load previous notes.</p>
        ) : prev === null ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : prev.length === 0 ? (
          <p className="text-[13px] text-slate-400">Nothing written up for this client yet.</p>
        ) : (
          prev.map(s => (
            <div key={s.id}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-slate-900">{s.title}</span>
                <span className="text-xs tabular-nums text-slate-400">
                  {new Date(s.scheduledAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })}
                </span>
              </p>
              {s.entries.length === 0 ? (
                <p className="mt-0.5 text-[13px] text-slate-400">No notes recorded.</p>
              ) : (
                <div className="mt-1 flex flex-col gap-1.5">
                  {s.entries.map((e, i) => (
                    <div key={i}>
                      {e.label && (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{e.label}</p>
                      )}
                      <p className={`whitespace-pre-line text-[13px] ${e.italic ? 'italic text-slate-600' : 'text-slate-700'}`}>
                        {e.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    )
  }

  // NOTES — the same form the session's own page uses, so a write-up started
  // here and finished there is one write-up, not two.
  //
  // `autoPromptIfEmpty` so it opens ON the questions rather than on a button
  // that opens the questions (Karl: "it should load the notes list view so you
  // can start filling in the notes there and then"). A trainer taps a session
  // to write it up; making them tap again to begin is a step that exists only
  // because the component can also be used as a summary elsewhere.
  return (
    <SessionFormReport
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      layout="inline"
      autoPromptIfEmpty
    />
  )
}
