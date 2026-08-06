import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// "A gate honoured on one path and missed on another is worse than none,
// because it will be trusted."
//
// The self-book route is exercised for real in booking-gate-self-book.test.ts.
// The rest of the booking paths run inside request-scoped handlers with a dozen
// collaborators each, so they are pinned here the way this repo already pins
// class-enrol-multi-session and class-enrol-send-invoice: against the source, on
// the decisions rather than the plumbing.
//
// The list of paths is not invented. It comes from an exhaustive sweep of every
// site that writes a TrainingSession, a ClientPackage or a ClassEnrollment.
const read = (p: string) => readFileSync(p, 'utf8')

const selfBook = read('src/app/api/my/self-book/route.ts')
const classEnrol = read('src/app/api/my/classes/[runId]/enroll/route.ts')
const bookingPage = read('src/app/api/c/[slug]/book/[pageSlug]/route.ts')
const basket = read('src/app/api/my/basket/checkout/route.ts')
const webhook = read('src/app/api/webhooks/stripe/connect/route.ts')

// ─── The client-initiated paths — all gated ─────────────────────────────────
describe('every path a CLIENT can book by is gated', () => {
  const gated: [string, string][] = [
    ['POST /api/my/self-book', selfBook],
    ['POST /api/my/classes/[runId]/enroll', classEnrol],
    ['POST /api/c/[slug]/book/[pageSlug]', bookingPage],
    ['POST /api/my/basket/checkout', basket],
  ]

  it.each(gated)('%s resolves the offering’s gate', (_name, src) => {
    expect(src).toContain('bookingGateFor(')
  })

  it.each(gated)('%s refuses a booking the gate is not satisfied by', (_name, src) => {
    expect(src).toContain('gateRefusal(')
  })

  // Storing whatever keys the body happened to carry would let anybody grow the
  // row and would put junk in front of the trainer reading the answers back.
  it.each(gated)('%s stores only the questions that are on the form', (_name, src) => {
    expect(src).toContain('pickGateAnswers(')
  })

  // The one thing that would make all of the above pointless. Nothing may open
  // the gate on the strength of what the client answered LAST time.
  it.each(gated)('%s never looks up a previous answer set', (_name, src) => {
    expect(src).not.toContain('bookingAnswerExists')
    expect(src).not.toMatch(/bookingFormAnswer\.find/)
  })
})

// ─── Class enrolment ────────────────────────────────────────────────────────
describe('class / drop-in / event enrolment', () => {
  it('takes answers with the enrolment', () => {
    expect(classEnrol).toContain('answers: z')
  })

  // A run can carry its own questions; an offering's apply to every run of it.
  it('looks at the run AND the offering behind it', () => {
    expect(classEnrol).toContain('bookingGateFor({ classRunId: runId, packageId: run.packageId })')
  })

  // The gate has to come before the card box: taking money and then asking
  // questions is the wrong order, and refusing after a charge is the half-done
  // state AGENTS.md #4 is about.
  it('checks the gate BEFORE it mints a checkout', () => {
    expect(classEnrol.indexOf('gateRefusal(')).toBeLessThan(classEnrol.indexOf('createConnectCheckout('))
  })

  it('…and before it enrols anybody', () => {
    expect(classEnrol.indexOf('gateRefusal(')).toBeLessThan(classEnrol.indexOf('await enrollInRun('))
  })

  // A class has no diary slot, so no BookingHold. The answers cross the payment
  // on the PaymentItem intent — our own row, not Stripe metadata.
  it('carries the answers across a payment on the first line’s intent', () => {
    expect(classEnrol).toContain('gate: { formId: gate.formId, stepId: gate.stepId, answers: gateAnswers }')
    expect(classEnrol).toContain('grossLines[0] = {')
  })

  it('records what was said against the ENROLMENT it created', () => {
    expect(classEnrol).toContain('anchor: { enrollmentId: result.enrollmentId }')
  })
})

// ─── The public booking page ────────────────────────────────────────────────
describe('the public booking page', () => {
  it('inherits the gate of the package it books', () => {
    expect(bookingPage).toContain('const gate = pkg ? await bookingGateFor({ packageId: pkg.id }) : null')
  })

  it('checks it before the card box and before it books anything', () => {
    expect(bookingPage.indexOf('gateRefusal(')).toBeLessThan(bookingPage.indexOf('createConnectCheckout('))
    expect(bookingPage.indexOf('gateRefusal(')).toBeLessThan(bookingPage.indexOf('materializeBooking(tx'))
  })

  // A stranger on this page produces an ENQUIRY — no session, no place, nothing
  // booked. The trainer accepts it, and that is a trainer-side action.
  it('leaves the stranger branch creating an enquiry and nothing bookable', () => {
    const strangerBranch = bookingPage.slice(bookingPage.indexOf('── Prospect:'))
    expect(strangerBranch).toContain('prisma.enquiry.create')
    expect(strangerBranch).not.toContain('materializeBooking')
    expect(strangerBranch).not.toContain('bookingRequest.create')
  })

  // A signed-in client's own hold must not make their own slot look taken.
  it('resolves who is booking before it re-checks the slot', () => {
    expect(bookingPage.indexOf('const client = session?.user?.id'))
      .toBeLessThan(bookingPage.indexOf('await isSlotAvailable('))
    expect(bookingPage).toContain('excludeClientId: client?.id ?? null')
  })

  // Only created when there IS a gate — an ungated booking page keeps exactly
  // the slot behaviour it has today.
  it('only holds a slot through checkout when there is something to answer', () => {
    expect(bookingPage).toContain('if (gate && pkg) {')
    expect(bookingPage).toContain('createBookingHold({')
  })
})

// ─── The basket ─────────────────────────────────────────────────────────────
describe('the mixed basket', () => {
  // A basket is still a booking, and an ungated door beside a gated one is the
  // one everybody ends up using.
  it('refuses a gated class line that arrived with no answers', () => {
    expect(basket).toContain('unavailable.push({ key: line.key, reason: `Answer')
  })

  // Rule (2) of that route: nothing is charged unless every line is still good.
  it('refuses it as an unavailable LINE, so the whole basket is held back', () => {
    expect(basket.indexOf('Answer “${gate.form.name}”'))
      .toBeLessThan(basket.indexOf('if (unavailable.length > 0)'))
  })

  it('carries the answers into the first line’s intent', () => {
    expect(basket).toContain('intent: { ...(classLines[0].intent as Record<string, unknown>), gate: lineGate }')
  })
})

// ─── The webhook — the paid continuation of all of them ─────────────────────
describe('the Stripe connect webhook', () => {
  it('reads a 1:1 booking’s answers off the hold the checkout carried', () => {
    expect(webhook).toContain('intent.holdId')
    expect(webhook).toContain('tx.bookingHold.findUnique')
  })

  // A hold id is on our own row, but one belonging to somebody else must never
  // write answers against this booking.
  it('will not spend another client’s hold', () => {
    expect(webhook).toContain('hold.clientId === args.clientId')
  })

  it('records a paid booking’s answers against the session it created', () => {
    expect(webhook).toContain('anchor: { sessionId: sessionIds[0] }')
  })

  it('consumes the hold, so a live hold is never left beside a real session', () => {
    expect(webhook).toContain('consumeBookingHold(hold.id, tx)')
  })

  it('records a paid class booking’s answers against the enrolment', () => {
    expect(webhook).toContain('anchor: { enrollmentId: r.enrollmentId }')
  })
})

// ─── The trainer's own path — deliberately NOT gated ────────────────────────
//
// "A groomer entering a booking at the desk should not be blocked by a form the
// client hasn't filled in." The trainer is standing in front of the dog; making
// them answer the client's questions to write a booking down would be absurd,
// and refusing the booking would be worse.
describe('a trainer booking on the client’s behalf', () => {
  const trainerPaths: [string, string][] = [
    ['POST /api/clients/[clientId]/packages', 'src/app/api/clients/[clientId]/packages/route.ts'],
    ['POST /api/schedule/sessions', 'src/app/api/schedule/sessions/route.ts'],
    ['POST /api/class-runs/[runId]/enrollments', 'src/app/api/class-runs/[runId]/enrollments/route.ts'],
    ['POST /api/enquiries/[id]/accept', 'src/lib/enquiries.ts'],
    ['PATCH /api/booking-requests/[id] (confirm)', 'src/lib/booking-request-confirm.ts'],
  ]

  it.each(trainerPaths)('%s is never refused for an unanswered form', (_name, path) => {
    expect(read(path)).not.toContain('gateRefusal')
  })

  // …and the client is still asked. The gating step is an ordinary
  // session-anchored FORM step, so the flow cron delivers it for a session that
  // arrived this way — and skips it only for one that was answered at booking.
  it('the flow still asks the client afterwards', () => {
    const flows = read('src/lib/comms-flows.ts')
    expect(flows).toContain('step.gatesBooking')
    expect(flows).toContain('bookingAnswerExists({ formId, sessionId })')
    // Skipped WITHOUT recording a send, so a trainer-entered booking keeps being
    // asked until the client answers rather than being marked delivered for ever.
    const idx = flows.indexOf('if (step.gatesBooking')
    expect(flows.slice(idx, idx + 400)).toContain('skipped++')
    expect(flows.slice(idx, idx + 400)).not.toContain('commsFlowSend.create')
  })

  // The one thing the trainer path must NOT drop: an approval-required booking
  // was gated when the CLIENT made the request, and those answers have to reach
  // the session the trainer's approval creates (bug #8).
  it('carries a gated request’s answers onto the session it confirms', () => {
    const confirm = read('src/lib/booking-request-confirm.ts')
    expect(confirm).toContain('carryRequestAnswersToSession(')
    // Read outside the Google try/catch, or a flaky calendar sync could swallow
    // the answers with it.
    expect(confirm.indexOf('carryRequestAnswersToSession('))
      .toBeLessThan(confirm.indexOf('syncSessionsToGoogle'))
  })
})

// ─── The cron ───────────────────────────────────────────────────────────────
describe('the hold sweep', () => {
  const cron = read('src/app/api/cron/booking-holds/route.ts')

  it('is CRON_SECRET-guarded like every other cron route', () => {
    expect(cron).toContain('`Bearer ${process.env.CRON_SECRET}`')
    expect(cron).toContain("status: 401")
  })

  it('is scheduled by pg_cron in a migration, never vercel.json', () => {
    const sql = read('prisma/migrations/20260806201000_booking_holds_cron/migration.sql')
    expect(sql).toContain('cron.schedule(')
    expect(sql).toContain('/api/cron/booking-holds')
    // vercel.json exists (it pins the region) and must never grow a crons key —
    // this project schedules everything through Supabase.
    expect(JSON.parse(read('vercel.json'))).not.toHaveProperty('crons')
  })

  // The sweep only deletes. It is housekeeping, and the read is what frees a
  // slot — otherwise an hour would stay locked for a whole cron interval after
  // it should have been free.
  it('only deletes rows — it is not what frees a slot', () => {
    const holds = read('src/lib/booking-holds.ts')
    const idx = holds.indexOf('export async function sweepBookingHolds')
    const body = holds.slice(idx)
    expect(body).toContain('deleteMany')
    expect(body).not.toContain('update(')
  })
})
