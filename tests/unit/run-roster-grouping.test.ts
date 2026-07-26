import { describe, it, expect } from 'vitest'
import { groupByClient, worstInvoiceState, type Enrollment } from '@/components/trainer/run-roster'

// Karl: "Clients must not repeat on group classes." On a drop-in class — the
// demo doggy daycare is the worst case — an enrolment is a BOOKING, not a
// person: eight clients held 27 of them, so every list keyed on raw enrolments
// printed "Bailey's Owner" four times in a row. groupByClient is the one place
// that folds bookings into people, and both the roster table AND the Details-tab
// snapshot/counts now go through it, so a name can't appear twice on one list.
//
// The exception that must survive: one owner bringing TWO dogs is genuinely two
// lines, because attendance and invoices are per dog.

let n = 0
function enrol(over: Partial<Enrollment> = {}): Enrollment {
  n += 1
  return {
    id: `e${n}`,
    status: 'ENROLLED',
    type: 'DROP_IN',
    invoiceState: null,
    waitlistPosition: null,
    source: 'TRAINER',
    dropInSessionId: `s${n}`,
    dropInSessionAt: null,
    dropInSessionIndex: null,
    clientId: 'c1',
    clientName: "Hannah Whitfield",
    dogName: 'Bailey',
    dogPhotoUrl: null,
    attendedCount: 0,
    markedCount: 0,
    ticketTierId: null,
    ticketName: null,
    ticketPriceCents: null,
    quantity: 1,
    ...over,
  }
}

describe('groupByClient — one line per person (per dog)', () => {
  it('folds four bookings by the same client+dog into a single row', () => {
    const groups = groupByClient([enrol(), enrol(), enrol(), enrol()])
    expect(groups).toHaveLength(1)
    expect(groups[0].clientName).toBe('Hannah Whitfield')
    // Every underlying booking is still addressable — withdrawing is one action
    // over all of them.
    expect(groups[0].ids).toHaveLength(4)
  })

  it('keeps one owner with two dogs as two rows', () => {
    const groups = groupByClient([
      enrol({ dogName: 'Bailey' }),
      enrol({ dogName: 'Bailey' }),
      enrol({ dogName: 'Milo' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.dogName).sort()).toEqual(['Bailey', 'Milo'])
  })

  it('keeps different people apart', () => {
    const groups = groupByClient([
      enrol({ clientId: 'c1', clientName: 'Hannah Whitfield', dogName: 'Bailey' }),
      enrol({ clientId: 'c2', clientName: 'Tom Ellery', dogName: 'Max' }),
      enrol({ clientId: 'c2', clientName: 'Tom Ellery', dogName: 'Max' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('an enrolled booking outranks a waitlisted one in the row status', () => {
    const groups = groupByClient([enrol({ status: 'WAITLISTED', waitlistPosition: 2 }), enrol({ status: 'ENROLLED' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].status).toBe('ENROLLED')
    expect(groups[0].waitlistPosition).toBe(2)
  })

  it('sums attendance across the folded bookings', () => {
    const groups = groupByClient([
      enrol({ attendedCount: 1, markedCount: 1 }),
      enrol({ attendedCount: 0, markedCount: 1 }),
    ])
    expect(groups[0].attendedCount).toBe(1)
    expect(groups[0].markedCount).toBe(2)
  })

  it('collects the uninvoiced bookings so one "Create" repairs all of them', () => {
    const groups = groupByClient([
      enrol({ invoiceState: 'PAID' }),
      enrol({ invoiceState: null }),
      enrol({ invoiceState: null }),
    ])
    expect(groups[0].uninvoicedIds).toHaveLength(2)
    // …and the row shows the worst state of the lot, which is "no invoice".
    expect(groups[0].invoiceState).toBeNull()
  })
})

describe('a multi-ticket event guest is still one guest', () => {
  // The event screen's own flavour of the same fault: an event sells named
  // tickets, so one owner can hold "General × 3" AND "VIP × 3" — two enrolment
  // rows, one person. The guest snapshot listed raw enrolments, so they read as
  // two guests, over a badge that disagreed with the table below it.
  it('folds two ticket types bought by one person into one row, keeping both labels', () => {
    const groups = groupByClient([
      enrol({ type: 'FULL', ticketName: 'General', quantity: 3 }),
      enrol({ type: 'FULL', ticketName: 'VIP', quantity: 3 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].ticketLabel).toBe('General × 3 · VIP × 3')
  })

  it('still gives one owner with two dogs two rows on an event', () => {
    const groups = groupByClient([
      enrol({ type: 'FULL', dogName: 'Bailey', ticketName: 'General', quantity: 1 }),
      enrol({ type: 'FULL', dogName: 'Milo', ticketName: 'General', quantity: 1 }),
    ])
    expect(groups).toHaveLength(2)
  })
})

describe('the detail screens read their counts off the folded rows', () => {
  // A source check rather than a render: the arithmetic lives inline in two
  // client components. What must never come back is `.slice(0, 6)` over the
  // RAW enrolments — that is exactly what printed the same owner three times.
  const screens = {
    'classes/[runId]/run-detail.tsx': 'src/app/(trainer)/classes/[runId]/run-detail.tsx',
    'events/[eventId]/event-detail.tsx': 'src/app/(trainer)/events/[eventId]/event-detail.tsx',
  }

  for (const [name, rel] of Object.entries(screens)) {
    it(`${name} slices groups, not enrolments`, async () => {
      const { readFileSync } = await import('node:fs')
      const path = await import('node:path')
      const src = readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
      expect(src, name).toMatch(/groupByClient\(/)
      expect(src, name).toMatch(/(presentGroups|pastGroups)\.slice\(0, 6\)/)
      expect(src, name).not.toMatch(/\bpresent\.slice\(/)
    })
  }
})

describe('worstInvoiceState — the thing to chase wins', () => {
  it('ranks no-invoice worst, then unsent, sent, paid', () => {
    expect(worstInvoiceState(['PAID', null])).toBeNull()
    expect(worstInvoiceState(['PAID', 'UNSENT'])).toBe('UNSENT')
    expect(worstInvoiceState(['PAID', 'SENT'])).toBe('SENT')
    expect(worstInvoiceState(['PAID', 'PAID'])).toBe('PAID')
    expect(worstInvoiceState(['CANCELLED'])).toBe('CANCELLED')
  })
})
