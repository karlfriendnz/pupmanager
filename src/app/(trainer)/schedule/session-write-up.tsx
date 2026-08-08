'use client'

import { useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
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
  clientName,
  dogNames,
}: {
  sessionId: string
  sessionStatus: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'
  clientName: string | null
  dogNames: string[]
}) {
  const [open, setOpen] = useState(false)
  const [prev, setPrev] = useState<PrevSession[] | null>(null)
  const [failed, setFailed] = useState(false)

  async function togglePrevious() {
    const next = !open
    setOpen(next)
    if (!next || prev !== null) return
    try {
      const res = await fetch(`/api/sessions/${sessionId}/previous`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setPrev(data.items ?? [])
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* WHO — a third of the row on a wide popover, full width on a phone
          where a third is four words a line (Karl asked for the third). */}
      <div className="sm:max-w-[33%]">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Client</p>
        <p className="mt-1 truncate text-sm font-medium text-slate-900">{clientName ?? '—'}</p>
        {dogNames.length > 0 && (
          <p className="mt-0.5 truncate text-[13px] text-slate-500">{dogNames.join(', ')}</p>
        )}
      </div>

      {/* WHAT YOU WROTE LAST TIME — a button, closed by default. It's context,
          not the task, so it shouldn't push the form down the screen until
          it's asked for. */}
      <div className="rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={togglePrevious}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-700 active:bg-slate-50"
        >
          <History className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
          <span className="flex-1">Previous notes</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="border-t border-slate-200 px-3 py-3">
            {failed ? (
              <p className="text-[13px] text-red-600">Could not load previous notes.</p>
            ) : prev === null ? (
              <p className="text-[13px] text-slate-400">Loading…</p>
            ) : prev.length === 0 ? (
              <p className="text-[13px] text-slate-400">Nothing written up for this client yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {prev.map(s => (
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
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* THE FORM — the same one the session's own page uses, so a write-up
          started here and finished there is one write-up, not two. */}
      <SessionFormReport sessionId={sessionId} sessionStatus={sessionStatus} layout="inline" />
    </div>
  )
}
