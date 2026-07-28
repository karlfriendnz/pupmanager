import type { Prisma } from '@/generated/prisma'

// Where a client is up to, DERIVED from what they've booked — never stored.
//
// The list used to filter ClientProfile.status on NEW / ACTIVE / INACTIVE, which
// made activity a value somebody had to maintain. Stored activity needs a
// nightly recalculation, and that recalculation then fights whatever a staff
// member set by hand. Derived, it is simply always right, needs no cron and
// needs no column.
//
// It also fixes the framing. "Active / Inactive" is wrong for a course business:
// clients do a five-week course and finish BY DESIGN. Calling the other 90%
// "Inactive" says they lapsed, when they are the repeat-and-referral pool — the
// most valuable list the trainer has.
//
// ── THE TRAP ────────────────────────────────────────────────────────────────
// Do NOT ask whether the class STARTS in the future. A five-week course that
// began on 18 July is still running, and its clients are still in class. On the
// customer's own data, `startDate >= now` returns 4 clients out of 684; "the run
// still has a session to come" returns 60, which is the number on the trainer's
// own spreadsheet.
export type ClientView = 'current' | 'past' | 'never' | 'archived'

/**
 * Archived means a human pressed the button that hides this person. It is the
 * ONE thing status is still for, because it is a decision, not a fact you can
 * work out from the data.
 */
export const ARCHIVED_STATUS = 'INACTIVE'

/** Everyone the three activity views are computed over. */
export const notArchived: Prisma.ClientProfileWhereInput = {
  status: { not: ARCHIVED_STATUS },
}

/** Enrolled in a class run that still has a session to come. */
export function inClassNowWhere(now = new Date()): Prisma.ClientProfileWhereInput {
  return {
    classEnrollments: {
      some: {
        status: 'ENROLLED',
        // The run, not the enrolment: what matters is whether the COURSE has
        // anything left to run, and a mid-course client is still in class.
        classRun: { sessions: { some: { scheduledAt: { gte: now } } } },
      },
    },
  }
}

/** Has booked something — a class place or a package — at some point. */
export const hasEverBookedWhere: Prisma.ClientProfileWhereInput = {
  OR: [
    { classEnrollments: { some: {} } },
    { clientPackages: { some: {} } },
  ],
}

/**
 * The filter for one view. Every activity view excludes archived people; the
 * archived view is the only way to see them, and it ignores activity entirely.
 */
export function whereForView(view: ClientView, now = new Date()): Prisma.ClientProfileWhereInput {
  switch (view) {
    case 'archived':
      return { status: ARCHIVED_STATUS }
    case 'current':
      return { ...notArchived, ...inClassNowWhere(now) }
    case 'never':
      return {
        ...notArchived,
        classEnrollments: { none: {} },
        clientPackages: { none: {} },
      }
    case 'past':
      // Booked before, nothing still to come. NOT() around the current test
      // rather than a stored flag, so it can never drift out of step with it.
      return {
        ...notArchived,
        ...hasEverBookedWhere,
        NOT: inClassNowWhere(now),
      }
  }
}

/**
 * The tab a URL asks for. `new` and `inactive` are the old tab names and are
 * still in links, bookmarks and emails — they keep working, pointing at the
 * view that holds the same people they always did.
 */
export function viewFromTab(tab: string | undefined): ClientView {
  switch (tab) {
    case 'past': return 'past'
    case 'never':
    case 'new': return 'never'
    case 'archived':
    case 'inactive': return 'archived'
    default: return 'current'
  }
}

/** What the tab is called, and what it means, in the trainer's own terms. */
export const VIEW_LABEL: Record<ClientView, string> = {
  current: 'Current',
  past: 'Past client',
  never: 'Never booked',
  archived: 'Archived',
}

export const VIEW_BLURB: Record<ClientView, string> = {
  current: 'Booked onto a class that still has a session to come.',
  past: 'They have trained with you before. Nothing booked at the moment.',
  never: 'On your list, but they have never booked anything.',
  archived: 'Hidden by hand. They stay off the other three lists until you bring them back.',
}
