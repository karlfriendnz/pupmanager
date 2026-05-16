// General scheduling waitlist helpers. Pure matching/ordering logic is
// split out so it's unit-tested without a DB (see
// tests/unit/waitlist.test.ts). The waitlist is trainer-wide and
// distinct from the per-ClassRun waitlist.
import { prisma } from './prisma'

// ─── Pure logic ──────────────────────────────────────────────────────────────

export type WaitlistPrefs = {
  preferredDays: number[] // ISO weekday 1..7; [] = any day
  preferredTimeStart: string | null // "HH:MM" or null = any
  preferredTimeEnd: string | null
  earliestStart: Date | null
}

export type Opening = {
  date: Date
  /** ISO weekday 1=Mon … 7=Sun. */
  weekday: number
  /** "HH:MM" 24-hr start of the opening. */
  time: string
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Does a waiting person's stated preference match an available opening?
 * Empty/null preferences mean "no constraint" (always match that axis).
 * Used to surface "N people are waiting for slots like this".
 */
export function matchesOpening(prefs: WaitlistPrefs, opening: Opening): boolean {
  if (prefs.preferredDays.length > 0 && !prefs.preferredDays.includes(opening.weekday)) {
    return false
  }
  if (prefs.earliestStart && opening.date < prefs.earliestStart) {
    return false
  }
  const t = toMinutes(opening.time)
  if (prefs.preferredTimeStart && t < toMinutes(prefs.preferredTimeStart)) return false
  if (prefs.preferredTimeEnd && t > toMinutes(prefs.preferredTimeEnd)) return false
  return true
}

/** Next priority value to append an entry at the bottom of the list. */
export function nextPriority(maxPriority: number | null | undefined): number {
  return (maxPriority ?? -1) + 1
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

/** How many people are still actively waiting (drives the nudge badge). */
export function waitingCount(trainerId: string): Promise<number> {
  return prisma.waitlistEntry.count({
    where: { trainerId, status: 'WAITING' },
  })
}
