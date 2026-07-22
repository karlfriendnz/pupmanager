import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Booking someone into a package or class sends "You're booked in" carrying a
// Pay now link. The invoice raised alongside it must NOT also email them —
// that's two emails seconds apart asking for the same money, which is what
// clients actually complained about.
//
// This is asserted against the source rather than by executing the routes:
// createInvoiceForAssignment defers its email inside next/after, which only
// runs in a request scope, so a unit test can't observe the send. What we can
// pin is that every caller which ALSO emails the client passes notifyClient:
// false — that's the invariant that broke.

const read = (p: string) => readFileSync(p, 'utf8')

// Routes that raise an invoice AND send their own client email.
const DOUBLE_EMAIL_RISK = [
  'src/app/api/clients/[clientId]/packages/route.ts',
  'src/app/api/class-runs/[runId]/enrollments/route.ts',
  'src/app/api/my/classes/[runId]/enroll/route.ts',
]

// Routes that raise an invoice and send NOTHING else — the invoice email is
// the client's only notification and must keep firing.
const INVOICE_EMAIL_IS_THE_ONLY_ONE = [
  'src/app/api/my/products/[productId]/buy/route.ts',
  'src/app/api/my/products/[productId]/request/route.ts',
  'src/app/api/clients/[clientId]/product-requests/route.ts',
]

describe('one email per booking', () => {
  it.each(DOUBLE_EMAIL_RISK)('%s suppresses the invoice email', (file) => {
    const src = read(file)
    expect(src).toContain('createInvoiceForAssignment')
    // It emails the client itself…
    expect(src).toContain('notifyClient({')
    // …so the invoice must not.
    expect(src).toContain('notifyClient: false')
  })

  it.each(INVOICE_EMAIL_IS_THE_ONLY_ONE)('%s still lets the invoice email send', (file) => {
    const src = read(file)
    expect(src).toContain('createInvoiceForAssignment')
    expect(src).not.toContain('notifyClient: false')
  })

  it('the suppression is opt-in, so an unspecified caller still emails', () => {
    const src = read('src/lib/invoicing.ts')
    // `!== false` (not `=== true`) is what makes the default "do email".
    expect(src).toContain("input.notifyClient !== false")
  })
})
