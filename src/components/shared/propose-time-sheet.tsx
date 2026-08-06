'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Loader2, X } from 'lucide-react'
import { ModalPortal } from './modal-portal'

// "Suggest a different time" — the composer both sides of a booking
// negotiation use.
//
// One component, two entry points, deliberately: the trainer opens it by
// dragging or tapping on their schedule (the time is already chosen, so it
// opens straight on the note), and either party opens it from the thread card
// with nothing chosen yet (so it opens on the day + time picker). Two screens
// for the same act would drift apart on the wording, which is the one thing
// Karl signs off.
//
// The times are fetched from /api/booking-requests/[id]/times — computed by the
// same helper the propose route gates with, so the picker cannot offer an hour
// the send would refuse. It never computes its own.

export interface ProposeTimeSheetProps {
  requestId: string
  /** Pre-chosen start (ISO) — set when the trainer dragged/tapped a slot. */
  initialStartIso?: string | null
  /** Trainer-local YYYY-MM-DD the picker opens on. Defaults to today. */
  initialDate?: string
  onClose: () => void
  /** Fired after a successful send, so the caller can refresh its thread/grid. */
  onSent?: () => void
}

interface TimesResponse {
  tz: string
  times: string[]
  packageName: string
  sessionCount: number
  weeksBetween: number
  durationMins: number
  defaultMessage: string
  party: 'TRAINER' | 'CLIENT'
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "14:30" → "2:30 PM", without pulling a formatter in for a fixed shape. */
function label12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export function ProposeTimeSheet({
  requestId,
  initialStartIso = null,
  initialDate,
  onClose,
  onSent,
}: ProposeTimeSheetProps) {
  const [date, setDate] = useState(initialDate ?? todayStr())
  const [meta, setMeta] = useState<TimesResponse | null>(null)
  const [loadingTimes, setLoadingTimes] = useState(false)
  // Seeded from the time they dragged to. `send()` would have used the preset
  // anyway, but the picker opened with NOTHING selected — so the sheet looked
  // like it had forgotten the time, which is exactly how Karl read it. The
  // wall clock is read back in the same zone the drag built it in.
  const [time, setTime] = useState<string | null>(() => {
    if (!initialStartIso) return null
    const at = new Date(initialStartIso)
    if (Number.isNaN(at.getTime())) return null
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  })
  const [note, setNote] = useState('')
  const [noteTouched, setNoteTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A pre-chosen start means the trainer already said WHEN on the calendar;
  // this sheet is then only the note.
  const preset = initialStartIso ? new Date(initialStartIso) : null
  const presetValid = preset !== null && !Number.isNaN(preset.getTime())

  // Karl's standing rule: never two scrollbars. The page behind is locked for
  // as long as the sheet is open, and the sheet's own scroller hides its rail.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  const loadTimes = useCallback(async (forDate: string) => {
    setLoadingTimes(true)
    setError(null)
    try {
      const res = await fetch(`/api/booking-requests/${requestId}/times?date=${forDate}`)
      if (!res.ok) throw new Error('load failed')
      const data = await res.json() as TimesResponse
      setMeta(data)
      setNote(prev => (noteTouched ? prev : data.defaultMessage))
    } catch {
      setError('Couldn’t load the available times.')
    } finally {
      setLoadingTimes(false)
    }
  }, [requestId, noteTouched])

  useEffect(() => { void loadTimes(date) }, [date, loadTimes])

  async function send() {
    let startIso: string | null = null
    if (presetValid && !time) {
      startIso = preset!.toISOString()
    } else if (time) {
      const [h, m] = time.split(':').map(Number)
      const [y, mo, d] = date.split('-').map(Number)
      // The times come back as the TRAINER's local wall clock. Building the
      // instant from the browser's own zone is only correct when the two agree;
      // when they don't, the server re-derives from the same picker anyway and
      // refuses anything that isn't genuinely free — so a mismatch is caught,
      // never silently booked. (A trainer and their client on different sides
      // of the world is the case this note is for.)
      const local = new Date(y, mo - 1, d, h, m, 0, 0)
      startIso = local.toISOString()
    }
    if (!startIso) {
      setError('Pick a time first.')
      return
    }

    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/booking-requests/${requestId}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startIso, message: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'That didn’t send. Try again.')
        return
      }
      onSent?.()
      onClose()
    } catch {
      setError('That didn’t send. Try again.')
    } finally {
      setSending(false)
    }
  }

  const seriesNote =
    meta && meta.sessionCount > 1
      ? `The other ${meta.sessionCount - 1} session${meta.sessionCount === 2 ? '' : 's'} move with it, ${meta.weeksBetween === 1 ? 'a week' : `${meta.weeksBetween} weeks`} apart.`
      : null

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4"
        onClick={() => !sending && onClose()}
      >
        <div
          data-testid="propose-time-sheet"
          className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white sm:max-w-md sm:rounded-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex flex-shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3">
            <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-700" strokeWidth={1.75} aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900">Suggest a different time</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {meta?.packageName ?? 'Booking request'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="-m-2 p-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
            {presetValid && !time && (
              <div className="mb-4 rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Proposing</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                  {preset!.toLocaleString('en-NZ', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </p>
                {seriesNote && <p className="mt-1 text-sm text-slate-500">{seriesNote}</p>}
              </div>
            )}

            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="propose-date">
              {presetValid ? 'Or pick another day' : 'Day'}
            </label>
            <input
              id="propose-date"
              type="date"
              value={date}
              min={todayStr()}
              onChange={e => { setDate(e.target.value); setTime(null) }}
              disabled={sending}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600,#2a9da9)]"
            />

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Time</p>
            {loadingTimes ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Loading times…
              </p>
            ) : meta && meta.times.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nothing free that day. Try another.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {meta?.times.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(t)}
                    disabled={sending}
                    aria-pressed={time === t}
                    className={`min-h-11 rounded-xl border px-2 text-sm font-medium disabled:opacity-50 ${
                      time === t
                        ? 'border-[var(--pm-brand-600,#2a9da9)] bg-[var(--pm-brand-50,#effafa)] text-slate-900'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label12(t)}
                  </button>
                ))}
              </div>
            )}

            <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="propose-note">
              Message
            </label>
            <textarea
              id="propose-note"
              value={note}
              onChange={e => { setNote(e.target.value); setNoteTouched(true) }}
              disabled={sending}
              rows={3}
              maxLength={2000}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600,#2a9da9)]"
            />
            <p className="mt-1 text-sm text-slate-500">
              This goes into your messages, where they can approve it or suggest another.
            </p>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>

          <div className="flex flex-shrink-0 items-stretch border-t border-slate-200 text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="min-h-12 flex-1 px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="propose-send"
              onClick={send}
              disabled={sending || (!time && !presetValid)}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 px-2 text-[var(--pm-brand-700,#1f7d87)] hover:bg-slate-50 disabled:opacity-50"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
              Send suggestion
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
