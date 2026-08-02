'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarOff, CalendarClock, Loader2, MoreHorizontal, Undo2 } from 'lucide-react'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { FlatBlock } from '@/components/shared/flat-list'

// What a trainer can do to ONE week of a run without touching the other fifteen.
//
// A weekly casual class hits Labour Day; another week has to start an hour later
// because the hall is double-booked. Both used to mean editing the whole class,
// or deleting the session — which took the register and every drop-in booking
// with it, and which the nightly top-up put back a day later anyway.
//
// A full screen, not a menu hanging off the row: cancelling a week people have
// paid for wants a reason field and a sentence saying what happens to them, and
// none of that fits in a 56px popover on a phone.

export type Occurrence = {
  id: string
  runId: string
  /** ISO. */
  scheduledAt: string
  durationMins: number | null
  location: string | null
  cancelledAt: string | null
  cancelReason: string | null
  /** Set once this week's time or venue was set by hand. */
  scheduleOverriddenAt: string | null
}

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, in the browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function OccurrenceActionsButton({
  occurrence,
  label,
  bookedCount,
}: {
  occurrence: Occurrence
  /** How this week reads in the list, so the sheet can name what you opened. */
  label: string
  /** Casual bookings held against THIS week, so cancelling can say who it hits. */
  bookedCount?: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        aria-label={`Change ${label}`}
        className="-m-1.5 flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors active:bg-slate-100"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open && (
        <OccurrenceSheet
          occurrence={occurrence}
          label={label}
          bookedCount={bookedCount}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function OccurrenceSheet({
  occurrence,
  label,
  bookedCount,
  onClose,
}: {
  occurrence: Occurrence
  label: string
  bookedCount?: number
  onClose: () => void
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'menu' | 'cancel' | 'move'>('menu')
  const [reason, setReason] = useState(occurrence.cancelReason ?? '')
  const [at, setAt] = useState(toLocalInput(occurrence.scheduledAt))
  const [duration, setDuration] = useState(String(occurrence.durationMins ?? 60))
  const [location, setLocation] = useState(occurrence.location ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancelled = occurrence.cancelledAt !== null

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/class-runs/${occurrence.runId}/sessions/${occurrence.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: unknown } | null
      setError(typeof payload?.error === 'string' ? payload.error : 'That did not save. Try again.')
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <FullScreenSheet
      title={mode === 'cancel' ? 'Cancel this one' : mode === 'move' ? 'Move this one' : 'This session'}
      sub={label}
      onClose={mode === 'menu' ? onClose : () => setMode('menu')}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {mode === 'menu' && (
          <FlatBlock>
            {cancelled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => send({ cancelled: false })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50 disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4 flex-shrink-0 text-slate-500" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">Put this one back on</span>
                  <span className="block text-xs text-slate-400">
                    {occurrence.cancelReason ? `Cancelled — ${occurrence.cancelReason}` : 'Currently cancelled'}
                  </span>
                </span>
                {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode('cancel')}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50"
              >
                <CalendarOff className="h-4 w-4 flex-shrink-0 text-slate-500" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">Cancel just this one</span>
                  <span className="block text-xs text-slate-400">A public holiday, a closed hall — the rest of the run carries on.</span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('move')}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50"
            >
              <CalendarClock className="h-4 w-4 flex-shrink-0 text-slate-500" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">Move just this one</span>
                <span className="block text-xs text-slate-400">A different time, a different length, a different venue.</span>
              </span>
            </button>
          </FlatBlock>
        )}

        {mode === 'cancel' && (
          <>
            <p className="text-sm leading-relaxed text-slate-500">
              Everyone on this class is told. Nobody loses their place — a casual
              booking for this week stays booked, so you can refund it or move
              them to another week yourself.
              {bookedCount ? ` ${bookedCount} casual booking${bookedCount === 1 ? '' : 's'} for this week.` : ''}
            </p>
            <div>
              <label htmlFor="cancelReason" className="mb-1 block text-sm font-medium text-slate-700">
                What should they be told?
              </label>
              <input
                id="cancelReason"
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={200}
                placeholder="Labour Day"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-[11px] text-slate-400">Optional. It goes into the message they get.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ cancelled: true, reason: reason.trim() || null })}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white transition-colors active:bg-red-700 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel this session
            </button>
          </>
        )}

        {mode === 'move' && (
          <>
            <p className="text-sm leading-relaxed text-slate-500">
              Only this week moves. The rest of the run keeps its usual time, and
              nothing that tops the class up later will put this one back.
            </p>
            <div>
              <label htmlFor="occurrenceAt" className="mb-1 block text-sm font-medium text-slate-700">Starts</label>
              <input
                id="occurrenceAt"
                type="datetime-local"
                value={at}
                onChange={e => setAt(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label htmlFor="occurrenceDuration" className="mb-1 block text-sm font-medium text-slate-700">Minutes</label>
              <input
                id="occurrenceDuration"
                type="number"
                min={5}
                max={480}
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="h-11 w-full max-w-[8rem] rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label htmlFor="occurrenceLocation" className="mb-1 block text-sm font-medium text-slate-700">Where</label>
              <input
                id="occurrenceLocation"
                value={location}
                onChange={e => setLocation(e.target.value)}
                maxLength={300}
                placeholder="Leave blank to use the class venue"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <button
              type="button"
              disabled={busy || !at}
              onClick={() => {
                const iso = new Date(at).toISOString()
                send({
                  scheduledAt: iso,
                  durationMins: Math.max(5, Math.min(480, Number(duration) || 60)),
                  location: location.trim() || null,
                })
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white transition-colors active:bg-accent-strong disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Move this session
            </button>
          </>
        )}
      </div>
    </FullScreenSheet>
  )
}
