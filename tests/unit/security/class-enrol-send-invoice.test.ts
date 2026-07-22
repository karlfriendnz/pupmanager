import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Enrolling raises an invoice; `sendInvoice` decides whether the client is
// asked to pay NOW (invoice marked sent + Pay now button in their email) or the
// invoice is left as a draft to chase later. Before this, that followed a
// trainer-wide autoSendInvoices setting which 30 of 32 real trainers had off —
// so invoices were raised and silently never sent.
//
// Asserted against the route source: the behaviour lives in a request-scoped
// handler whose invoice side-effects run inside next/after, so a unit test
// can't observe them end-to-end. What it CAN pin is the decision logic.
const route = readFileSync('src/app/api/class-runs/[runId]/enrollments/route.ts', 'utf8')

describe('enrolment → invoice sending', () => {
  it('accepts an explicit sendInvoice choice', () => {
    expect(route).toContain('sendInvoice: z.boolean().optional()')
  })

  // Unspecified must behave exactly as before, or existing callers change
  // behaviour silently.
  it('falls back to the trainer’s autoSendInvoices when unspecified', () => {
    expect(route).toContain('parsed.data.sendInvoice ?? (trainer?.autoSendInvoices ?? false)')
  })

  // createInvoiceForAssignment stamps sentAt from autoSendInvoices, so an
  // explicit choice has to override it in BOTH directions.
  it('writes sentAt to match the choice either way', () => {
    expect(route).toContain('sentAt: sendInvoice ? new Date() : null')
  })

  // No Pay now button on an invoice we've decided not to send yet.
  it('only resolves a pay link when the invoice is being sent', () => {
    const idx = route.indexOf('if (sendInvoice) {')
    expect(idx).toBeGreaterThan(-1)
    expect(route.slice(idx, idx + 260)).toContain('payToken')
  })

  it('still suppresses the duplicate invoice email', () => {
    expect(route).toContain('notifyClient: false')
  })
})
