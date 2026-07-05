// Pure, client-side filter for the schedule's staff-member switcher.
//
// The schedule already loads every session for the visible range (scoped
// server-side by `schedule.viewAll`). When a trainer with whole-company
// visibility picks a specific staff member, we narrow the *rendered* sessions
// to that member — a pure view filter, no new query. Conflict/availability
// logic deliberately keeps using the unfiltered set (see schedule-view).

// Sentinel for "no filter — show everyone". `null`/`undefined`/'' behave the
// same so callers can pass a raw URL param straight through.
export const MEMBER_EVERYONE = 'everyone'
// Sessions with no assigned membership (assignedMembershipId === null).
export const MEMBER_UNASSIGNED = 'unassigned'

export type MemberFilter = string | null | undefined

/**
 * Narrow a list of sessions to the chosen staff member.
 *
 *  • `everyone` / null / undefined / '' → the full list (no filter)
 *  • `unassigned`                        → only sessions with no assignee
 *  • any other value (a membership id)   → sessions assigned to that member
 */
export function filterSessionsByMember<T extends { assignedMembershipId: string | null }>(
  sessions: T[],
  filter: MemberFilter,
): T[] {
  if (!filter || filter === MEMBER_EVERYONE) return sessions
  if (filter === MEMBER_UNASSIGNED) return sessions.filter(s => s.assignedMembershipId == null)
  return sessions.filter(s => s.assignedMembershipId === filter)
}

/**
 * Resolve a raw URL param (or persisted value) to a valid selection, given the
 * members the current user may filter by and whether any unassigned sessions
 * exist. Unknown ids / stale selections collapse to `everyone` so the UI never
 * shows an empty calendar for a member who no longer exists.
 */
export function resolveMemberFilter(
  raw: MemberFilter,
  knownMemberIds: readonly string[],
  hasUnassigned: boolean,
): string {
  if (!raw || raw === MEMBER_EVERYONE) return MEMBER_EVERYONE
  if (raw === MEMBER_UNASSIGNED) return hasUnassigned ? MEMBER_UNASSIGNED : MEMBER_EVERYONE
  return knownMemberIds.includes(raw) ? raw : MEMBER_EVERYONE
}
