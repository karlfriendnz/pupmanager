import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A client booking several drop-in sessions of one class does it in a single
// pass: one checkout, one enrolment per session. Asserted against the route
// source for the same reason as the trainer-side enrolment tests — the
// side-effects run inside a request-scoped handler (Stripe checkout, the
// connect webhook, invoicing) that a unit test can't observe end-to-end, but
// the decisions the route makes are pinnable.
const route = readFileSync('src/app/api/my/classes/[runId]/enroll/route.ts', 'utf8')

describe('POST /api/my/classes/[runId]/enroll — several drop-in sessions', () => {
  it('accepts a list of sessions', () => {
    expect(route).toContain('sessionIds: z.array(z.string().min(1)).min(1).max(52).optional()')
  })

  // The single-session form is what the wizard used to send and what any
  // older client build still sends.
  it('still accepts the single sessionId form', () => {
    expect(route).toContain('parsed.data.sessionIds ?? (parsed.data.sessionId ? [parsed.data.sessionId] : [])')
  })

  // A stale list (a session that's been, or isn't in this class) means the
  // client is looking at out-of-date options — better to send them back than
  // to book the subset that still works.
  it('rejects the whole request if any chosen session is invalid', () => {
    expect(route).toContain('if (found.length !== new Set(wanted).size)')
  })

  // Each session is priced by its own slot, so the charge is the SUM.
  it('totals the per-session prices rather than charging one', () => {
    expect(route).toContain('perSession.reduce<number | null>')
    expect(route).toContain('sessionDropInPriceCents(d.slot, run.package)')
  })

  // Capacity is per session; charging for three and seating two is the worst
  // outcome, so a full session sends them back rather than part-booking.
  it('checks every chosen session for room and refuses if any is full', () => {
    expect(route).toContain('const rejected = decisions.filter(d => d.decision === ')
    expect(route).toContain('are full — choose again')
  })

  // One Stripe line per session, each carrying its own intent: the connect
  // webhook fulfils class lines one at a time, so a single line with
  // quantity 3 would take the money and seat them once.
  it('emits one checkout line per session, each with its own session intent', () => {
    const idx = route.indexOf('lines: type === ')
    expect(idx).toBeGreaterThan(-1)
    const block = route.slice(idx, idx + 900)
    expect(block).toContain('perSession.map(s => ({')
    expect(block).toContain('intent: { classRunId: runId, type, dogId: dogId ?? null, sessionId: s.id }')
  })

  // The free / pay-later path fans out the same way.
  it('enrols each session and invoices each one on the pay-later path', () => {
    expect(route).toContain('for (const sid of targets)')
    expect(route).toContain('for (const r of results.filter(r => r.status === ')
  })

  // A drop-in clashes only with the sessions they already hold — booking two
  // more Saturdays is normal. A FULL seat is still one per client and dog.
  it('scopes the already-booked check to the chosen sessions', () => {
    expect(route).toContain('dropInSessionId: { in: dropIns.map(d => d.id) }')
    expect(route).toContain('You’ve already booked one of those sessions.')
  })

  it('still refuses a drop-in on top of a full enrolment', () => {
    expect(route).toContain('dropInSessionId: null')
    expect(route).toContain('You’re already enrolled in this class.')
  })
})
