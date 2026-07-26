// When is a 1:1 package "past"?
//
// Classes, drop-ins and events answer this from a date — the run has a last
// session, and once it's been the run is past. A 1:1 package has no date of
// its own: it's a template a trainer assigns to one client at a time, and it
// has no archived flag in the schema either. So the only honest signal is what
// the package is DOING.
//
// The rule, and it's the same one the class list uses one level down: a
// package's "runs" are its assignments, and the package is past when every one
// of them has finished.
//
//   • Never assigned            → CURRENT. It's for sale and waiting for its
//                                 first client; a brand new package is not a
//                                 finished one.
//   • Any assignment still live → CURRENT.
//   • Every assignment finished → PAST.
//
// An assignment is finished when its last session has been. It is NOT finished
// while it has a session still to come, while it has no sessions yet (just
// assigned, not yet scheduled), or while it's set to extend indefinitely —
// those top themselves up forever, so they can never finish on their own.

export type PackageAssignment = {
  /** Ongoing assignment — the schedule keeps topping it up. */
  extendIndefinitely: boolean
  /** When this assignment's LAST session is/was, epoch ms. Null = none yet. */
  lastSessionAt: number | null
}

export function isAssignmentFinished(a: PackageAssignment, now: number): boolean {
  if (a.extendIndefinitely) return false
  if (a.lastSessionAt === null) return false
  return a.lastSessionAt < now
}

/** True when the package has been used and is now done with. */
export function isPackagePast(assignments: PackageAssignment[], now: number): boolean {
  return assignments.length > 0 && assignments.every(a => isAssignmentFinished(a, now))
}
