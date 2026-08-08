'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, X } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { SessionTimeTracking, type TimeEntry, type TeamMember } from '@/components/session-time-tracking'
import { accentIconStyle } from './session-actions'

/**
 * "Log time" as a row that opens a modal (Karl: "could log time be a modal?").
 *
 * It was a screen of its own, which meant leaving the session to record four
 * fields and coming back. Four fields is not a screen's worth of work, and the
 * thing you were doing — running the session — is on the screen behind it.
 *
 * Body scroll is LOCKED while it's open. That is not optional: a panel that
 * scrolls while the page scrolls behind it puts two scrollbars on screen, which
 * is Karl's standing rule and reads as a broken window.
 */
export function LogTimeRow({
  sessionId,
  entries,
  members,
  accent,
}: {
  sessionId: string
  entries: TimeEntry[]
  members: TeamMember[]
  accent?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  function close() {
    setOpen(false)
    // Whatever was added or deleted changes the row's own total behind it.
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
      >
        <Clock className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" style={accentIconStyle(accent)} strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">Log time</span>
        {totalMinutes > 0 && (
          <span className="flex-shrink-0 text-[13px] text-slate-500">
            {Number((totalMinutes / 60).toFixed(2))} h
          </span>
        )}
      </button>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
            onClick={close}
          >
            <div
              className="no-scrollbar max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-xl sm:max-w-md sm:rounded-3xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
                <h2 className="font-semibold text-slate-900">Log time</h2>
                <button onClick={close} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-5">
                <SessionTimeTracking sessionId={sessionId} initialEntries={entries} members={members} />
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
