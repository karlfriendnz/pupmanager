import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/self-book, with the REAL gate and hold code running underneath.
//
// This is the path Karl described: "for every groom in a 1:1 package i ask the
// client the same questions before they confirm the booking." The wizard shows
// the questions as a step of its own — and that is a courtesy. What is asserted
// here is the half that counts: a crafted POST that skips the form books
// nothing, on every branch (instant, approval-required, and pay-to-confirm).
//
// lib/booking-gate and lib/booking-holds are deliberately NOT mocked; only the
// database beneath them is.
const h = vi.hoisted(() => ({
  activeClient: vi.fn(),
  clientFindUnique: vi.fn(),
  pkgFindFirst: vi.fn(),
  stepFindFirst: vi.fn(),
  formFindUnique: vi.fn(),
  requestCreate: vi.fn(),
  answerCreate: vi.fn(),
  sessionFindMany: vi.fn(),
  holdFindFirst: vi.fn(),
  holdFindUnique: vi.fn(),
  holdUpdate: vi.fn(),
  holdDeleteMany: vi.fn(),
  createAssignment: vi.fn(),
  checkout: vi.fn(),
  availability: vi.fn(),
  checkStart: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => {
  const db = {
    clientProfile: { findUnique: h.clientFindUnique },
    package: { findFirst: h.pkgFindFirst },
    commsFlowStep: { findFirst: h.stepFindFirst },
    form: { findUnique: h.formFindUnique },
    bookingRequest: { create: h.requestCreate },
    bookingFormAnswer: { create: h.answerCreate, findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    trainingSession: { findMany: h.sessionFindMany },
    bookingHold: {
      findFirst: h.holdFindFirst, findUnique: h.holdFindUnique, findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(), update: h.holdUpdate, delete: vi.fn(), deleteMany: h.holdDeleteMany,
    },
    trainerProfile: { findUnique: vi.fn() },
  }
  return { prisma: { ...db, $transaction: (fn: (c: typeof db) => unknown) => fn(db) } }
})
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.activeClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: vi.fn() }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: vi.fn() }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: vi.fn() }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: () => true }))
vi.mock('@/lib/require-payment', () => ({ resolveRequirePayment: () => true }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.checkout }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.example.com' } }))
vi.mock('@/lib/offering-visibility', () => ({ offeringVisibleWhere: () => ({}) }))
vi.mock('@/lib/client-availability', () => ({ getTrainerAvailabilityForClient: h.availability }))
vi.mock('@/lib/package-booking-window', () => ({
  packageBookingWindow: () => null,
  checkBookableStart: h.checkStart,
}))
vi.mock('@/lib/self-book', () => ({
  generateSessionDates: (start: Date, count: number) =>
    Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * 7 * 86_400_000)),
  createBookingAssignment: h.createAssignment,
}))

import { POST } from '@/app/api/my/self-book/route'

const TRAINER = 'tr_1'
const CLIENT = 'cl_1'
const PKG = 'pkg_groom'
const FORM = 'form_pregroom'
const START = new Date(Date.now() + 3 * 86_400_000).toISOString()

const QUESTIONS = [
  { id: 'q1', type: 'TEXT', label: 'Any new bites or sore spots?', required: true },
  { id: 'q2', type: 'TEXT', label: 'Anything else?', required: false },
]

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://app.example.com/api/my/self-book', {
    method: 'POST',
    body: JSON.stringify({ packageId: PKG, startDate: START, ...body }),
  }))

/** Turn the offering's gate on. */
function gateOn() {
  h.stepFindFirst.mockResolvedValue({ id: 'step_1', payload: { formId: FORM } })
  h.formFindUnique.mockResolvedValue({
    id: FORM, trainerId: TRAINER, name: 'Pre-groom questions', description: null,
    questions: QUESTIONS, steps: [], isActive: true,
  })
}

function pricedWithPayments() {
  h.pkgFindFirst.mockResolvedValue({
    id: PKG, name: 'The Full Groom', sessionCount: 1, weeksBetween: 1, durationMins: 60,
    bufferMins: 0, sessionType: 'IN_PERSON', priceCents: 8000, specialPriceCents: null,
    selfBookRequiresApproval: false, requirePayment: true,
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.activeClient.mockResolvedValue({ clientId: CLIENT, isPreview: false })
  h.clientFindUnique.mockResolvedValue({
    id: CLIENT, trainerId: TRAINER, dogId: 'dog_1',
    user: { name: 'Sam' }, dog: { name: 'Bailey' },
    trainer: { user: { id: 'u_tr' } }, assignedTrainer: null,
  })
  h.pkgFindFirst.mockResolvedValue({
    id: PKG, name: 'The Full Groom', sessionCount: 1, weeksBetween: 1, durationMins: 60,
    bufferMins: 0, sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null,
    selfBookRequiresApproval: false, requirePayment: false,
  })
  h.stepFindFirst.mockResolvedValue(null) // no gate unless a test turns it on
  h.formFindUnique.mockResolvedValue(null)
  h.availability.mockResolvedValue({ tz: 'UTC', slots: [], blackouts: [], busy: [] })
  h.checkStart.mockReturnValue({ ok: true })
  h.createAssignment.mockResolvedValue('cp_1')
  h.sessionFindMany.mockResolvedValue([{ id: 'sess_1' }, { id: 'sess_2' }])
  h.requestCreate.mockResolvedValue({ id: 'req_1' })
  h.answerCreate.mockResolvedValue({ id: 'bfa_1' })
  h.holdFindFirst.mockResolvedValue(null)
  h.holdUpdate.mockResolvedValue({})
  h.holdDeleteMany.mockResolvedValue({ count: 1 })
  h.checkout.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
  const { prisma } = await import('@/lib/prisma')
  ;(prisma.trainerProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1',
    payoutCurrency: 'nzd', sandboxBilling: true, defaultRequirePayment: true,
  })
})

// ─── Nothing changes for a trainer who set no form ──────────────────────────
describe('an offering with no gate', () => {
  it('books in one call, exactly as it always has', async () => {
    const res = await post({})
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ mode: 'booked' })
    expect(h.createAssignment).toHaveBeenCalledTimes(1)
    expect(h.answerCreate).not.toHaveBeenCalled()
  })
})

// ─── The gate ───────────────────────────────────────────────────────────────
describe('a crafted POST that skips the form', () => {
  beforeEach(gateOn)

  it('books nothing on the instant path', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FORM_REQUIRED', missing: ['q1'] })
    expect(h.createAssignment).not.toHaveBeenCalled()
  })

  it('books nothing when it answered only the OPTIONAL question', async () => {
    const res = await post({ answers: { q2: 'nothing' } })
    expect(res.status).toBe(400)
    expect(h.createAssignment).not.toHaveBeenCalled()
  })

  it('raises no BookingRequest on the approval path', async () => {
    h.pkgFindFirst.mockResolvedValue({
      id: PKG, name: 'The Full Groom', sessionCount: 1, weeksBetween: 1, durationMins: 60,
      bufferMins: 0, sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null,
      selfBookRequiresApproval: true, requirePayment: false,
    })
    expect((await post({})).status).toBe(400)
    expect(h.requestCreate).not.toHaveBeenCalled()
  })

  // The most important of the three: the gate is checked BEFORE the card box.
  // Taking money and then asking questions is the wrong order, and a refusal
  // after a charge is the half-done state AGENTS.md #4 is about.
  it('mints no Stripe checkout on the pay-to-confirm path', async () => {
    pricedWithPayments()
    expect((await post({})).status).toBe(400)
    expect(h.checkout).not.toHaveBeenCalled()
  })
})

describe('once they have answered', () => {
  beforeEach(gateOn)

  it('books, and records what was said against the session', async () => {
    const res = await post({ answers: { q1: 'a sore spot on her left ear' } })
    expect(res.status).toBe(201)
    expect(h.createAssignment).toHaveBeenCalledTimes(1)
    expect(h.answerCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: TRAINER, clientId: CLIENT, formId: FORM,
      // The session they actually chose and held — not all six of them.
      sessionId: 'sess_1',
      answers: { q1: 'a sore spot on her left ear' },
    })
  })

  // Belt and braces on the payload: what gets stored is what the form asked.
  it('stores only the questions that are on the form', async () => {
    await post({ answers: { q1: 'no', smuggled: 'x' } })
    expect(h.answerCreate.mock.calls[0][0].data.answers).toEqual({ q1: 'no' })
  })

  it('parks the answers on the REQUEST when the trainer has to approve it', async () => {
    h.pkgFindFirst.mockResolvedValue({
      id: PKG, name: 'The Full Groom', sessionCount: 1, weeksBetween: 1, durationMins: 60,
      bufferMins: 0, sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null,
      selfBookRequiresApproval: true, requirePayment: false,
    })
    const res = await post({ answers: { q1: 'no' } })
    expect(await res.json()).toMatchObject({ mode: 'requested' })
    expect(h.answerCreate.mock.calls[0][0].data).toMatchObject({
      bookingRequestId: 'req_1', sessionId: null, enrollmentId: null,
    })
  })
})

// ─── Form, then pay ─────────────────────────────────────────────────────────
describe('the order of the form and the money', () => {
  beforeEach(() => { gateOn(); pricedWithPayments() })

  it('answers first, THEN the card box', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    const res = await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(await res.json()).toMatchObject({ mode: 'payment' })
    expect(h.checkout).toHaveBeenCalledTimes(1)
  })

  // Nothing is booked yet on this path — the webhook does that — so nothing may
  // be recorded as a completed booking either. The answers travel on the hold.
  it('records no booking and no answer row until the payment lands', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(h.createAssignment).not.toHaveBeenCalled()
    expect(h.answerCreate).not.toHaveBeenCalled()
  })

  // A declined card must not send somebody back to an empty form. The answers
  // are written to the hold on the way OUT to Stripe, not on the way back.
  it('saves the answers onto the hold before leaving for Stripe', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    await post({ answers: { q1: 'a sore spot' }, holdId: 'hold_1' })
    const answerWrite = h.holdUpdate.mock.calls.find(c => 'answers' in c[0].data)
    expect(answerWrite?.[0].data.answers).toEqual({ q1: 'a sore spot' })
  })

  it('and extends the hold to cover the card', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(h.holdUpdate.mock.calls.some(c => 'expiresAt' in c[0].data)).toBe(true)
  })

  // The webhook has no request body, so the hold id has to be on the intent or
  // the answers cannot cross the payment.
  it('carries the hold id into the checkout intent', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(h.checkout.mock.calls[0][0].lines[0].intent).toMatchObject({ holdId: 'hold_1' })
  })
})

// ─── The hold ───────────────────────────────────────────────────────────────
describe('a hold that lapsed while they were answering', () => {
  beforeEach(gateOn)

  it('is refused with a code the wizard turns into "pick another time"', async () => {
    h.holdFindFirst.mockResolvedValue(null) // expired: the read filters it out
    const res = await post({ answers: { q1: 'no' }, holdId: 'hold_gone' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'HOLD_EXPIRED' })
    expect(h.createAssignment).not.toHaveBeenCalled()
  })

  // Somebody else's hold id is not a way to book. The claim has to be theirs.
  it('another client’s hold is not theirs to spend', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: 'cl_someone_else', answers: {} })
    const res = await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(res.status).toBe(409)
    expect(h.createAssignment).not.toHaveBeenCalled()
  })

  it('a live one books and is marked consumed, not left occupying the slot', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold_1', clientId: CLIENT, answers: {} })
    const res = await post({ answers: { q1: 'no' }, holdId: 'hold_1' })
    expect(res.status).toBe(201)
    expect(h.holdUpdate.mock.calls.some(c => 'consumedAt' in c[0].data)).toBe(true)
  })
})

// ─── The repeat groom ───────────────────────────────────────────────────────
describe('the next booking asks again', () => {
  beforeEach(gateOn)

  it('a previous answer set does not book the next one', async () => {
    // Groom 1: answered, booked, recorded.
    expect((await post({ answers: { q1: 'no' } })).status).toBe(201)
    expect(h.answerCreate).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    // Re-arm everything except the answers.
    h.activeClient.mockResolvedValue({ clientId: CLIENT, isPreview: false })
    h.clientFindUnique.mockResolvedValue({
      id: CLIENT, trainerId: TRAINER, dogId: 'dog_1',
      user: { name: 'Sam' }, dog: { name: 'Bailey' },
      trainer: { user: { id: 'u_tr' } }, assignedTrainer: null,
    })
    h.pkgFindFirst.mockResolvedValue({
      id: PKG, name: 'The Full Groom', sessionCount: 1, weeksBetween: 1, durationMins: 60,
      bufferMins: 0, sessionType: 'IN_PERSON', priceCents: null, specialPriceCents: null,
      selfBookRequiresApproval: false, requirePayment: false,
    })
    gateOn()
    h.availability.mockResolvedValue({ tz: 'UTC', slots: [], blackouts: [], busy: [] })
    h.checkStart.mockReturnValue({ ok: true })

    // Groom 2, the same client, the same form, sending nothing.
    const res = await post({})
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FORM_REQUIRED' })
    expect(h.createAssignment).not.toHaveBeenCalled()
  })
})

// ─── Preview ────────────────────────────────────────────────────────────────
describe('a trainer previewing the client app', () => {
  it('still cannot book, gate or no gate', async () => {
    gateOn()
    h.activeClient.mockResolvedValue({ clientId: CLIENT, isPreview: true })
    expect((await post({ answers: { q1: 'no' } })).status).toBe(403)
  })
})
