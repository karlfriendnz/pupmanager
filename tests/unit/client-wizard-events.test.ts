import { describe, it, expect } from 'vitest'
import { toWizardEvent, type WizardEventRunInput } from '@/lib/client-wizard-events'

// The client booking wizard's event mapping. The rule under test is the money
// one: an event that sells tickets is priced BY THE TICKET, and its package
// price must never reach the client. That is the exact bug fixed in d736544 —
// a $200 ticket was quoted (and would have been charged) at the offering's
// leftover $45 — and /api/my/classes/[runId]/enroll now refuses any ticketed
// booking that doesn't name a tier, so a wizard that quoted the package price
// would 400 as well as lie.

function run(over: Partial<WizardEventRunInput> = {}): WizardEventRunInput {
  return {
    id: 'r1',
    name: 'Puppy Social',
    imageUrl: null,
    scheduleNote: null,
    capacity: null,
    package: {
      name: 'Puppy Social (one-off)',
      priceCents: 4500,
      specialPriceCents: null,
      capacity: null,
      allowWaitlist: false,
      ticketTiers: [],
    },
    enrollments: [],
    sessions: [{ scheduledAt: new Date('2026-08-01T09:00:00.000Z'), durationMins: 60 }],
    ...over,
  }
}

const TIERS = [
  { id: 't1', name: 'General entry', priceCents: 20000, capacity: 80 },
  { id: 't2', name: 'VIP', priceCents: 12300, capacity: 32 },
  { id: 't3', name: 'Child', priceCents: 8900, capacity: null },
]

describe('toWizardEvent', () => {
  it('never exposes the package price once the event sells tickets', () => {
    const out = toWizardEvent(run({
      package: { ...run().package, priceCents: 4500, ticketTiers: TIERS },
    }))

    // The $45 must not be reachable by the UI at all.
    expect(out.priceCents).toBeNull()
    expect(out.tiers.map(t => t.priceCents)).toEqual([20000, 12300, 8900])
  })

  it('uses the package price for an event with no tickets, special price winning', () => {
    expect(toWizardEvent(run()).priceCents).toBe(4500)
    expect(toWizardEvent(run({
      package: { ...run().package, specialPriceCents: 3000 },
    })).priceCents).toBe(3000)
  })

  it('counts a tier down by the QUANTITY bought, not the number of rows', () => {
    const out = toWizardEvent(run({
      package: { ...run().package, ticketTiers: TIERS },
      // One booking of three VIP tickets takes three places, not one.
      enrollments: [
        { quantity: 3, ticketTierId: 't2' },
        { quantity: null, ticketTierId: 't1' }, // legacy row, no quantity → 1
      ],
    }))

    expect(out.tiers.find(t => t.id === 't2')!.spacesLeft).toBe(29)
    expect(out.tiers.find(t => t.id === 't1')!.spacesLeft).toBe(79)
    // An uncapped tier stays uncapped rather than reporting a bogus number.
    expect(out.tiers.find(t => t.id === 't3')!.spacesLeft).toBeNull()
  })

  it('reports a sold-out tier as 0 and never goes negative', () => {
    const out = toWizardEvent(run({
      package: { ...run().package, ticketTiers: [{ id: 't1', name: 'General', priceCents: 5000, capacity: 2 }] },
      enrollments: [{ quantity: 5, ticketTierId: 't1' }],
    }))
    expect(out.tiers[0].spacesLeft).toBe(0)
  })

  it('takes seats left from the run capacity, falling back to the package', () => {
    expect(toWizardEvent(run({ capacity: 8, enrollments: [{ quantity: 2, ticketTierId: null }] })).seatsLeft).toBe(6)
    expect(toWizardEvent(run({ capacity: null, package: { ...run().package, capacity: 5 } })).seatsLeft).toBe(5)
    // Uncapped stays uncapped.
    expect(toWizardEvent(run()).seatsLeft).toBeNull()
  })

  it('carries the single session as the event start', () => {
    const out = toWizardEvent(run())
    expect(out.startsAt).toBe('2026-08-01T09:00:00.000Z')
    expect(out.durationMins).toBe(60)
  })

  it('survives a run whose sessions have all been trimmed', () => {
    const out = toWizardEvent(run({ sessions: [] }))
    expect(out.startsAt).toBeNull()
    expect(out.durationMins).toBeNull()
  })
})
