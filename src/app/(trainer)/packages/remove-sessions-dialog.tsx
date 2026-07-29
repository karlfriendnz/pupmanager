'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Lock, X } from 'lucide-react'
import type { RunSession } from './package-form'

/**
 * "You're taking this class from 8 sessions to 5 — which three go?"
 *
 * Shrinking a class used to rebuild the whole series from its cadence, which
 * always dropped the LAST sessions and gave the trainer no say. Worse, the
 * rebuild deleted every session row and recreated it, so the sessions that
 * SURVIVED came back with new ids and lost whatever hung off them.
 *
 * This asks instead. It opens with the last N ticked — the old behaviour, and
 * the common case — so confirming straight through does what it always did.
 * Anything else is a deliberate choice the trainer makes with the dates in
 * front of them.
 *
 * A session with attendance recorded cannot be picked: removing it would delete
 * that register, which is the one thing this system never does silently.
 */
export function RemoveSessionsDialog({
  sessions,
  removeCount,
  className,
  onCancel,
  onConfirm,
}: {
  /** Every session currently on the class, earliest first. */
  sessions: RunSession[]
  /** How many must go, from the number the trainer typed. */
  removeCount: number
  className: string
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  const locked = useMemo(
    () => new Set(sessions.filter(s => s.attendance > 0).map(s => s.id)),
    [sessions],
  )

  // Default to the last N that CAN go — matching what the old rebuild did,
  // while skipping any the register protects.
  const initial = useMemo(() => {
    const picked: string[] = []
    for (let i = sessions.length - 1; i >= 0 && picked.length < removeCount; i--) {
      if (!locked.has(sessions[i].id)) picked.push(sessions[i].id)
    }
    return picked
  }, [sessions, removeCount, locked])

  // Mounted only while it is open (the parent guards), so the initial pick is
  // computed fresh each time rather than synced back in an effect.
  const [chosen, setChosen] = useState<string[]>(initial)

  if (typeof document === 'undefined') return null

  const removable = sessions.length - locked.size
  const short = removable < removeCount
  const exact = chosen.length === removeCount
  const losingBookings = sessions
    .filter(s => chosen.includes(s.id) && s.dropIns > 0)
    .reduce((n, s) => n + s.dropIns, 0)

  function toggle(id: string) {
    if (locked.has(id)) return
    setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]))
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    })
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-title"
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 id="rm-title" className="text-base font-semibold text-slate-900">
              Which {removeCount === 1 ? 'session' : `${removeCount} sessions`} should come off?
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {className} goes from {sessions.length} to {sessions.length - removeCount}.
              The rest keep their dates and their bookings.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {short && (
          <div className="mx-5 mb-3 flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Only {removable} of these can be removed — the others have attendance recorded.
              Choose a smaller reduction, or cancel this class and create a new one.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5">
          <ul className="divide-y divide-slate-100 border-y border-slate-100">
            {sessions.map(s => {
              const isLocked = locked.has(s.id)
              const isChosen = chosen.includes(s.id)
              return (
                <li key={s.id}>
                  <label
                    className={`flex items-start gap-3 py-3 ${
                      isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-red-600"
                      checked={isChosen}
                      disabled={isLocked}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${isChosen ? 'text-red-700 line-through' : 'text-slate-800'}`}>
                        Session {s.index} — {fmt(s.atIso)}
                        <span className="text-slate-400"> · {time(s.atIso)}</span>
                      </span>
                      {isLocked ? (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <Lock className="h-3 w-3" />
                          {s.attendance} marked present — can&rsquo;t be removed
                        </span>
                      ) : s.dropIns > 0 ? (
                        <span className="mt-0.5 block text-xs text-amber-700">
                          {s.dropIns} {s.dropIns === 1 ? 'person is' : 'people are'} booked onto this date
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="p-5 pt-3">
          {losingBookings > 0 && (
            <p className="mb-3 flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {losingBookings} booked {losingBookings === 1 ? 'place' : 'places'} will be removed with
                {chosen.length === 1 ? ' this session' : ' these sessions'}. Nobody is told automatically —
                let them know yourself.
              </span>
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {chosen.length} of {removeCount} chosen
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-slate-300 px-4 h-9 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!exact}
                onClick={() => onConfirm(chosen)}
                className="rounded-lg bg-red-600 px-4 h-9 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Remove {chosen.length === 1 ? 'session' : `${chosen.length} sessions`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
