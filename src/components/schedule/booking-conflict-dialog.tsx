'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarClock, Users } from 'lucide-react'
import type { ConflictResult } from '@/lib/use-booking-conflicts'

// A promise-based, styled "possible double-booking" confirmation. The provider
// sits at the trainer-shell root; any booking surface calls requestConfirm(result)
// and awaits the trainer's choice (true = book anyway, false = cancel). Replaces
// the native window.confirm with something that actually shows WHAT clashes.

type Ctx = { requestConfirm: (r: ConflictResult) => Promise<boolean> }
const BookingConflictCtx = createContext<Ctx | null>(null)

export function useBookingConflictDialog(): Ctx | null {
  return useContext(BookingConflictCtx)
}

// Clean, app-consistent formatting (12-hour en-NZ, matching the schedule grid).
function fmtTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function BookingConflictProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<ConflictResult | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const requestConfirm = useCallback((r: ConflictResult) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setResult(r)
    })
  }, [])

  const settle = useCallback((v: boolean) => {
    setResult(null)
    resolver.current?.(v)
    resolver.current = null
  }, [])

  return (
    <BookingConflictCtx.Provider value={{ requestConfirm }}>
      {children}
      {result && (
        <ConflictDialog result={result} onCancel={() => settle(false)} onConfirm={() => settle(true)} />
      )}
    </BookingConflictCtx.Provider>
  )
}

function ConflictDialog({
  result,
  onCancel,
  onConfirm,
}: {
  result: ConflictResult
  onCancel: () => void
  onConfirm: () => void
}) {
  const sessions = result.sessionConflicts ?? []
  const busy = result.busyConflicts ?? []
  const count = sessions.length + busy.length

  // Esc cancels; focus the primary button on open.
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Possible double-booking"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-pm-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex flex-col items-center gap-2.5 px-6 pt-8 pb-5 text-center"
          style={{ backgroundImage: 'linear-gradient(180deg, #FFF7ED 0%, #FFFFFF 100%)' }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm ring-1 ring-amber-200/70">
            <CalendarClock className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Possible double-booking</h2>
          <p className="max-w-xs text-sm text-slate-500">
            That time already has {count === 1 ? 'something' : `${count} things`} on the calendar:
          </p>
        </div>

        {/* Conflicts */}
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto px-6">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{s.label || s.title || 'Session'}</p>
                <p className="text-xs text-slate-500">{fmtDay(s.scheduledAt)} · {fmtTime(s.scheduledAt)} · {s.durationMins} min</p>
              </div>
            </div>
          ))}
          {busy.map((b, i) => (
            <div key={`busy-${i}`} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#4285F4] ring-1 ring-slate-200">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{b.title || 'Google Calendar event'}</p>
                <p className="text-xs text-slate-500">{fmtDay(b.startsAt)} · {fmtTime(b.startsAt)} – {fmtTime(b.endsAt)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 p-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Pick another time
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
          >
            Book anyway
          </button>
        </div>
      </div>
    </div>
  )
}
