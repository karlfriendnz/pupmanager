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

// ── Drag-drop multi-session overlap ─────────────────────────────────────────
// A drag-drop can move MORE than the dragged session: a recurring package's
// followers shift with it. The member-scoped /api/schedule/conflicts check only
// looks at the dragged session's own slot, so knock-on follower clashes — and a
// solo trainer's unassigned overlaps — slip through. These pure helpers scan the
// FULL moved set against the trainer's existing sessions (from /api/schedule/range,
// which is not membership-narrowed for a viewAll owner) so the drop can pop the
// same confirm modal for every resulting clash.

/** An interval the drop is about to move. */
export type DropInterval = {
  id: string
  scheduledAt: string
  durationMins: number
  /** Present for group-class sessions. Two occurrences of the SAME run don't clash. */
  classRunId?: string | null
  /** The member who runs this session (null = unassigned → resolves to owner).
   *  Omit to opt out of per-member scoping entirely (legacy / solo callers). */
  assignedMembershipId?: string | null
}

/** An existing session the moved intervals might land on. */
export type ExistingSlot = {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  label?: string | null
  classRunId?: string | null
  /** The member who runs this session (null = unassigned → resolves to owner). */
  assignedMembershipId?: string | null
}

/**
 * Half-open overlap of the intervals a drag-drop is about to move (the dragged
 * session PLUS any recurring-package followers) against the trainer's existing,
 * non-moved sessions.
 *
 * Double-booking is PER PERSON: two sessions only clash when they overlap in
 * time AND share the same assigned member. A null/omitted assignee resolves to
 * `ownerMembershipId` — the established "unassigned = owner" rule — so an
 * owner-run session clashes with the company's unassigned bookings but not with
 * another member's. Pass `ownerMembershipId` to enable this scoping; omit it (or
 * pass undefined) and the check falls back to the old whole-company behaviour
 * where every unresolved member is `null` and therefore mutually clashing —
 * which is exactly what a solo (single-member) business wants anyway.
 *
 * Two occurrences of the SAME class run never clash (one shared event, not a
 * double-booking — mirrors the self-book rule). De-duped by existing-slot id.
 */
export function findDropClashes(
  moved: DropInterval[],
  existing: ExistingSlot[],
  ownerMembershipId?: string | null,
): ExistingSlot[] {
  // Resolve an assignee to the person actually accountable for the slot:
  // null/undefined → the owner (when known), else stays null.
  const runner = (membershipId: string | null | undefined): string | null =>
    membershipId ?? ownerMembershipId ?? null
  const movedIds = new Set(moved.map((m) => m.id))
  const clashes: ExistingSlot[] = []
  const seen = new Set<string>()
  for (const m of moved) {
    const startA = new Date(m.scheduledAt).getTime()
    if (isNaN(startA) || !m.durationMins) continue
    const endA = startA + m.durationMins * 60_000
    const runnerA = runner(m.assignedMembershipId)
    for (const s of existing) {
      if (movedIds.has(s.id) || seen.has(s.id)) continue
      // Different person → not a double-booking (two trainers at 2pm is fine).
      if (runner(s.assignedMembershipId) !== runnerA) continue
      // Same class run = the same shared event, not a clash.
      if (m.classRunId && s.classRunId && m.classRunId === s.classRunId) continue
      const startB = new Date(s.scheduledAt).getTime()
      if (isNaN(startB)) continue
      const endB = startB + s.durationMins * 60_000
      if (startA < endB && startB < endA) {
        seen.add(s.id)
        clashes.push(s)
      }
    }
  }
  return clashes
}

/** Map drop clashes into the shared ConflictResult shape the modal renders. */
export function clashesToConflictResult(
  clashes: ExistingSlot[],
  busyConflicts: ConflictResult['busyConflicts'] = [],
): ConflictResult {
  return {
    sessionConflicts: clashes.map((s) => ({
      id: s.id,
      title: s.title,
      scheduledAt: s.scheduledAt,
      durationMins: s.durationMins,
      label: s.label ?? null,
    })),
    busyConflicts,
  }
}

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

  // Confirm for an ALREADY-computed clash set (e.g. a drag-drop that ran its own
  // multi-session overlap scan). Same styled-modal + override semantics as
  // confirmBooking, but skips the fetch. Empty result → proceed silently.
  const confirmClashes = useCallback(async (result: ConflictResult): Promise<boolean> => {
    if (conflictMessage(result) === null) return true
    if (dialog) return dialog.requestConfirm(result)
    const message = conflictMessage(result)
    return typeof window === 'undefined' || !message ? true : window.confirm(message)
  }, [dialog])

  return { confirmBooking, confirmClashes }
}
