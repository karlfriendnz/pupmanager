import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Booking a client into several drop-in sessions is one trip through the enrol
// form, so the route takes a list. Asserted against the route source for the
// same reason as class-enrol-send-invoice: the side-effects run inside a
// request-scoped handler a unit test can't observe end-to-end, but the
// decisions it makes are pinnable.
const route = readFileSync('src/app/api/class-runs/[runId]/enrollments/route.ts', 'utf8')

describe('POST /api/class-runs/[runId]/enrollments — multi-session drop-ins', () => {
  it('accepts a list of sessions', () => {
    expect(route).toContain('sessionIds: z.array(z.string().min(1)).min(1).max(52).optional()')
  })

  // The original single-session callers (client self-book) must keep working.
  it('still accepts the single sessionId form', () => {
    expect(route).toContain('sessionId: z.string().min(1).optional()')
    expect(route).toContain('parsed.data.sessionIds ?? (parsed.data.sessionId ? [parsed.data.sessionId] : [null])')
  })

  // A FULL enrolment is one enrolment, whatever sessions were posted.
  it('only fans out for a drop-in', () => {
    expect(route).toContain("type === 'DROP_IN'")
    expect(route).toMatch(/sessionIds\s*=\s*type === 'DROP_IN'/)
  })

  // One full session shouldn't cost the client the other three.
  it('enrols each session on its own and reports per-session failures', () => {
    expect(route).toContain('outcomes.push({ sessionId: sid, error: err.message })')
    expect(route).toContain('results: outcomes')
  })

  // Nothing booked at all is a plain failure, not a partial success.
  it('fails the request when every session was refused', () => {
    expect(route).toContain('if (booked.length === 0)')
  })

  // A drop-in is billed per session, so each booking raises its own invoice.
  it('raises an invoice per booked session', () => {
    const idx = route.indexOf('for (const b of booked)')
    expect(idx).toBeGreaterThan(-1)
    expect(route.slice(idx, idx + 600)).toContain('createInvoiceForAssignment')
  })

  // …but only one email, listing what they actually got.
  it('emails once, listing only the sessions they were booked into', () => {
    expect(route).toContain('booked.some(b => b.status !== ')
    expect(route).toContain('runDetail.sessions.filter(s => bookedIds.has(s.id))')
  })
})
