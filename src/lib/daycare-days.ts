// Which weekdays a daycare is open, derived from its own day-parts.
//
// Its own module, with NO imports, because both sides need it: the board (a
// server component, via lib/puppy-school.ts, which pulls in Prisma) and the
// Settings → Daycare editor (a client component, which must not). Keeping the
// rule in one place is the whole point — if the editor previewed the open days
// with its own copy of this, the preview and the board would drift.

/**
 * ISO weekdays (1=Mon…7=Sun), sorted and deduped, that a set of day-parts run
 * on. `PackageSessionSlot.day` counts Sunday as 0 and Saturday as 6.
 *
 * No slots at all = the whole week, so an empty board still reads as a week
 * rather than collapsing to nothing.
 */
export function openDaysFromSlots(slots: { day: number }[]): number[] {
  const iso = new Set<number>()
  for (const s of slots) {
    if (Number.isInteger(s.day) && s.day >= 0 && s.day <= 6) iso.add(s.day === 0 ? 7 : s.day)
  }
  if (iso.size === 0) return [1, 2, 3, 4, 5, 6, 7]
  return [...iso].sort((a, b) => a - b)
}

/** ISO weekday → the short name shown to a trainer. */
export const ISO_DAY_LABEL: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
}
