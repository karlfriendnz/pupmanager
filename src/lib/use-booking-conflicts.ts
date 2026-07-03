'use client'

import { useCallback } from 'react'
import { useBookingConflictDialog } from '@/components/schedule/booking-conflict-dialog'

export type ConflictResult = {
  sessionConflicts: { id: string; title: string; scheduledAt: string; durationMins: number; label: string | null }[]
  busyConflicts: { startsAt: string; endsAt: string; title?: string | null }[]
}

export type ConflictCheckOpts = {
  /** Proposed start, ISO string. */
  startIso: string
  durationMins: number
  /** The assignee the session will be run by; omit/undefined = unassigned (owner). */
  membershipId?: string | null
  /** When rescheduling, the session being moved (so it doesn't clash with itself). */
  excludeSessionId?: string
}

/**
 * Build the human-readable "you already have … at this time" clause from a
 * conflict result, or null when there's nothing to warn about. Pure — unit-tested.
 */
export function conflictMessage(result: ConflictResult): string | null {
  const parts: string[] = []
  for (const c of result.sessionConflicts ?? []) {
    parts.push(c.label ? `a session with ${c.label}` : c.title ? `a session (“${c.title}”)` : 'another session')
  }
  for (const b of result.busyConflicts ?? []) {
    parts.push(b.title ? `“${b.title}” (Google Calendar)` : 'a Google Calendar event')
  }
  if (parts.length === 0) return null
  // De-dupe identical phrases and cap the list so the confirm stays readable.
  const uniq = Array.from(new Set(parts)).slice(0, 3)
  const list = uniq.length === 1 ? uniq[0] : `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`
  return `You already have ${list} at this time. Book anyway?`
}

/**
 * Shared conflict gate for every booking surface. Returns a `confirmBooking`
 * that fetches conflicts for the proposed slot, and if any exist prompts the
 * trainer to override. Resolves `true` to proceed, `false` to cancel. NEVER
 * blocks on its own error (a failed lookup resolves `true`).
 */
const EMPTY: ConflictResult = { sessionConflicts: [], busyConflicts: [] }

/**
 * Fetch conflicts for a proposed slot. The endpoint does a LIVE Google FreeBusy
 * check for exactly this window, so it's accurate at booking time regardless of
 * how stale the cached grid strips are. Best-effort: any error returns EMPTY (no
 * false positives, never blocks). Used both while the modal is open (live inline
 * warning) and on save (the confirm gate).
 */
export async function fetchBookingConflicts(opts: ConflictCheckOpts): Promise<ConflictResult> {
  try {
    const start = new Date(opts.startIso)
    if (isNaN(start.getTime()) || !opts.durationMins) return EMPTY
    const end = new Date(start.getTime() + opts.durationMins * 60_000)
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
    if (opts.membershipId) params.set('membershipId', opts.membershipId)
    if (opts.excludeSessionId) params.set('excludeSessionId', opts.excludeSessionId)

    const res = await fetch(`/api/schedule/conflicts?${params.toString()}`)
    if (!res.ok) return EMPTY
    const data = (await res.json()) as ConflictResult
    return { sessionConflicts: data.sessionConflicts ?? [], busyConflicts: data.busyConflicts ?? [] }
  } catch {
    return EMPTY
  }
}

export function useBookingConflicts() {
  const dialog = useBookingConflictDialog()

  // Final check on SAVE: re-runs the live lookup at the moment of committing.
  const confirmBooking = useCallback(async (opts: ConflictCheckOpts): Promise<boolean> => {
    const data = await fetchBookingConflicts(opts)
    if (conflictMessage(data) === null) return true // nothing clashes → proceed

    // Explicit confirm step — the trainer can always override. Prefer the styled
    // dialog; fall back to the native confirm if no provider is mounted.
    if (dialog) return dialog.requestConfirm(data)
    const message = conflictMessage(data)
    return typeof window === 'undefined' || !message ? true : window.confirm(message)
  }, [dialog])

  return { confirmBooking }
}
