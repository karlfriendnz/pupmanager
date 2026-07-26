import { effectiveCapacity } from './class-runs'

// Turning a one-off EVENT run into the shape the client booking wizard shows.
//
// Pure on purpose: this is where the ticket-vs-package price rule lives, and
// that rule is the one that has already been got wrong once (a $200 ticket sold
// for the offering's leftover $45 price — see the comment block at the top of
// /api/my/classes/[runId]/enroll). The rule, stated once:
//
//   An event that has ANY ticket tier is priced BY THE TICKET. Its package
//   price is meaningless and must never be shown or sent. `priceCents` comes
//   back null in that case, so there is nothing for the UI to quote by mistake.

export interface WizardEventTierInput {
  id: string
  name: string
  priceCents: number | null
  capacity: number | null
}

export interface WizardEventRunInput {
  id: string
  name: string
  imageUrl: string | null
  scheduleNote: string | null
  capacity: number | null
  package: {
    name: string
    priceCents: number | null
    specialPriceCents: number | null
    capacity: number | null
    allowWaitlist: boolean
    ticketTiers: WizardEventTierInput[]
  }
  /** ENROLLED rows only — what's already taken. */
  enrollments: { quantity: number | null; ticketTierId: string | null }[]
  sessions: { scheduledAt: Date; durationMins: number }[]
}

export interface WizardEventTierOutput {
  id: string
  name: string
  priceCents: number | null
  spacesLeft: number | null
}

export interface WizardEventOutput {
  id: string
  name: string
  imageUrl: string | null
  scheduleNote: string | null
  packageName: string
  startsAt: string | null
  durationMins: number | null
  seatsLeft: number | null
  priceCents: number | null
  tiers: WizardEventTierOutput[]
  allowWaitlist: boolean
}

export function toWizardEvent(run: WizardEventRunInput): WizardEventOutput {
  const first = run.sessions[0]
  const cap = effectiveCapacity(run.capacity, run.package.capacity)
  const seatsTaken = run.enrollments.reduce((n, e) => n + (e.quantity ?? 1), 0)
  const ticketed = run.package.ticketTiers.length > 0

  return {
    id: run.id,
    name: run.name,
    imageUrl: run.imageUrl,
    scheduleNote: run.scheduleNote,
    packageName: run.package.name,
    startsAt: first?.scheduledAt.toISOString() ?? null,
    durationMins: first?.durationMins ?? null,
    seatsLeft: cap == null ? null : Math.max(0, cap - seatsTaken),
    // The rule. Null whenever tickets exist.
    priceCents: ticketed ? null : (run.package.specialPriceCents ?? run.package.priceCents),
    tiers: run.package.ticketTiers.map(t => {
      const sold = run.enrollments
        .filter(e => e.ticketTierId === t.id)
        .reduce((n, e) => n + (e.quantity ?? 1), 0)
      return {
        id: t.id,
        name: t.name,
        priceCents: t.priceCents,
        spacesLeft: t.capacity == null ? null : Math.max(0, t.capacity - sold),
      }
    }),
    allowWaitlist: run.package.allowWaitlist,
  }
}
