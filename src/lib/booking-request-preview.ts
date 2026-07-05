// Preview a pending BookingRequest on the trainer's schedule. A client
// self-booked a package that needs approval; before confirming, the trainer
// deep-links to the schedule and sees the proposed sessions rendered as a
// ghost/preview overlay so they can eyeball placement and clashes. Nothing
// here creates real sessions — it's read-only until the trainer approves
// through the existing /api/booking-requests/[id] flow.
import { sessionTitle } from './self-book'

/** One proposed session, positioned on the grid like a real block. */
export interface PreviewBlock {
  /** Stable key/id for React + clash lookups. */
  key: string
  /** Proposed start, ISO string. */
  startIso: string
  durationMins: number
  title: string
}

/**
 * Map a booking request's proposed `sessionDates` (JSON string[]) into preview
 * blocks, one per valid date, titled exactly like the sessions the confirm
 * flow will create (so the ghost reads identically to the real thing). Invalid
 * / unparseable entries are dropped. Pure — unit-tested.
 */
export function buildPreviewBlocks(
  sessionDates: unknown,
  pkg: { name: string; sessionCount: number; durationMins: number },
): PreviewBlock[] {
  const raw = Array.isArray(sessionDates) ? sessionDates : []
  return raw
    .map(d => new Date(String(d)))
    .filter(d => !Number.isNaN(d.getTime()))
    .map((d, i) => ({
      key: `preview-${i}`,
      startIso: d.toISOString(),
      durationMins: pkg.durationMins,
      title: sessionTitle(pkg.name, pkg.sessionCount, i),
    }))
}

/** Deep-link to the schedule focused on a booking request's preview. */
export function schedulePreviewHref(requestId: string): string {
  return `/schedule?previewRequest=${encodeURIComponent(requestId)}`
}

/** An existing block a preview might overlap. */
export interface OverlapCandidate {
  scheduledAt: string
  durationMins: number
}

/**
 * Keys of the preview blocks that overlap ANY existing session (half-open
 * interval test, matching the drag-drop clash rule). Lets the grid tint
 * clashing ghosts red and the banner count them. Pure — unit-tested.
 */
export function previewClashKeys(
  blocks: PreviewBlock[],
  existing: OverlapCandidate[],
): Set<string> {
  const clashing = new Set<string>()
  for (const b of blocks) {
    const startA = new Date(b.startIso).getTime()
    if (Number.isNaN(startA) || !b.durationMins) continue
    const endA = startA + b.durationMins * 60_000
    for (const s of existing) {
      const startB = new Date(s.scheduledAt).getTime()
      if (Number.isNaN(startB) || !s.durationMins) continue
      const endB = startB + s.durationMins * 60_000
      if (startA < endB && startB < endA) {
        clashing.add(b.key)
        break
      }
    }
  }
  return clashing
}
