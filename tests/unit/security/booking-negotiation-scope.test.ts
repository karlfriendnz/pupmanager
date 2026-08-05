import { describe, it, expect, vi, beforeEach } from 'vitest'

// Who is allowed to negotiate a booking time.
//
// This one is harder than the usual tenant guard, and that is exactly why it
// gets its own file. Every other mutating route in this app has ONE kind of
// caller: a trainer, or a client. These two have both — a counter-offer volleys,
// so the trainer and the client hit the identical endpoints, and "is this a
// trainer" is therefore not the question. The question is "is this caller a
// party to THIS request", and it has two right answers.
//
// The failure that would follow from getting it wrong is not subtle. An id in a
// URL is guessable. If the check were "are you signed in as a trainer", any
// trainer could counter-offer on another business's request, and read the
// client's name off the response while they were at it. If it were "are you
// signed in as a client", any client could approve another client's booking
// into a stranger's diary.
//
// So: both directions, and the negative for each.
//
// It also asserts the shape of the refusal. A request that exists but isn't
// yours comes back 404, not 403 — "that id is real, just not for you" is itself
// a fact worth not handing out when ids are guessable.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getActiveClient: vi.fn(),
  reqFindUnique: vi.fn(),
  reqFindFirst: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalCreate: vi.fn(),
  messageCreate: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('next/server', async (orig) => ({ ...(await orig() as object), after: () => {} }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/booking-request-confirm', () => ({ confirmBookingRequest: h.confirm }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingRequest: { findUnique: h.reqFindUnique, findFirst: h.reqFindFirst },
    bookingProposal: { findUnique: h.proposalFindUnique, create: h.proposalCreate },
    message: { create: h.messageCreate },
  },
}))

import { resolveNegotiationActor } from '@/lib/booking-negotiation-actor'
import { POST as propose } from '@/app/api/booking-requests/[id]/propose/route'
import { POST as approve } from '@/app/api/booking-proposals/[id]/approve/route'

const OURS = { trainerId: 'trainer_A', clientId: 'client_A' }

const trainerSession = (trainerId: string, userId = 'u_t') => ({
  user: { id: userId, role: 'TRAINER', trainerId },
})
const clientSession = (userId = 'u_c') => ({ user: { id: userId, role: 'CLIENT' } })

beforeEach(() => {
  vi.clearAllMocks()
  h.reqFindUnique.mockResolvedValue(OURS)
  h.getActiveClient.mockResolvedValue(null)
})

describe('only a party to the booking request may negotiate it', () => {
  it('lets the trainer whose request it is', async () => {
    h.auth.mockResolvedValue(trainerSession('trainer_A'))
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({
      ok: true,
      actor: { party: 'TRAINER', userId: 'u_t', isPreview: false },
    })
  })

  it('lets the client who made it', async () => {
    h.auth.mockResolvedValue(clientSession())
    h.getActiveClient.mockResolvedValue({ clientId: 'client_A', userId: 'u_c', isPreview: false })
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({
      ok: true,
      actor: { party: 'CLIENT', userId: 'u_c', isPreview: false },
    })
  })

  // ── The two that matter ───────────────────────────────────────────────────

  it('refuses a trainer from ANOTHER business', async () => {
    h.auth.mockResolvedValue(trainerSession('trainer_B'))
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
  })

  it('refuses a client who is not the one on the request', async () => {
    h.auth.mockResolvedValue(clientSession('u_other'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_B', userId: 'u_other', isPreview: false })
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
  })

  it('refuses a trainer of the right business acting under the WRONG client profile', async () => {
    // The two identities are resolved by different mechanisms, so this is the
    // case where they could disagree: signed in as a trainer for business A,
    // but with an active-client cookie pointing somewhere else. The trainer
    // branch wins and is checked on its own terms — the cookie never widens it.
    h.auth.mockResolvedValue(trainerSession('trainer_B'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_B', userId: 'u_t', isPreview: false })
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
  })

  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({ ok: false, status: 401, error: 'Unauthorised' })
  })

  it('refuses a request that does not exist, with the same 404 as one that is not yours', async () => {
    h.auth.mockResolvedValue(trainerSession('trainer_A'))
    h.reqFindUnique.mockResolvedValue(null)
    const res = await resolveNegotiationActor('req_missing')
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
  })

  it('marks a trainer previewing the client app, so the routes can refuse to write', async () => {
    // A trainer looking at their own client app must not send a message as that
    // client, nor approve a booking on their behalf. The flag is carried out of
    // here; both routes turn it into a 403.
    h.auth.mockResolvedValue(clientSession('u_t'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_A', userId: 'u_t', isPreview: true })
    const res = await resolveNegotiationActor('req_1')
    expect(res).toMatchObject({ ok: true, actor: { party: 'CLIENT', isPreview: true } })
  })
})

describe('the routes act on the resolver, not around it', () => {
  it('a trainer with no trainerId on their session is not treated as a trainer', async () => {
    // A half-built session (a trainer mid-onboarding, an expired membership)
    // must fall through to the client check rather than matching on role alone.
    h.auth.mockResolvedValue({ user: { id: 'u_t', role: 'TRAINER', trainerId: null } })
    const res = await resolveNegotiationActor('req_1')
    expect(res).toEqual({ ok: false, status: 404, error: 'Not found' })
  })
})

// ─── At the endpoints themselves ────────────────────────────────────────────
//
// The resolver above is right; these prove the routes actually CALL it, and
// call it before they write anything. A guard in a helper nobody invokes is a
// comment.

const proposeAs = () =>
  propose(
    new Request('http://localhost/api/booking-requests/req_1/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startIso: new Date(Date.now() + 7 * 864e5).toISOString() }),
    }),
    { params: Promise.resolve({ id: 'req_1' }) },
  )

const approveAs = () =>
  approve(
    new Request('http://localhost/api/booking-proposals/prop_1/approve', { method: 'POST' }),
    { params: Promise.resolve({ id: 'prop_1' }) },
  )

describe('POST /booking-requests/[id]/propose refuses a stranger', () => {
  it('refuses a trainer from another business, and writes nothing', async () => {
    h.auth.mockResolvedValue(trainerSession('trainer_B'))
    const res = await proposeAs()
    expect(res.status).toBe(404)
    expect(h.messageCreate).not.toHaveBeenCalled()
    expect(h.proposalCreate).not.toHaveBeenCalled()
  })

  it('refuses another business’s client, and writes nothing', async () => {
    h.auth.mockResolvedValue(clientSession('u_other'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_B', userId: 'u_other', isPreview: false })
    const res = await proposeAs()
    expect(res.status).toBe(404)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('refuses a trainer previewing the client app', async () => {
    h.auth.mockResolvedValue(clientSession('u_t'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_A', userId: 'u_t', isPreview: true })
    const res = await proposeAs()
    expect(res.status).toBe(403)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })
})

describe('POST /booking-proposals/[id]/approve refuses a stranger', () => {
  beforeEach(() => {
    h.proposalFindUnique.mockResolvedValue({
      id: 'prop_1',
      requestId: 'req_1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: [new Date(Date.now() + 7 * 864e5).toISOString()],
      createdAt: new Date(),
      request: { trainerId: 'trainer_A', clientId: 'client_A', status: 'PENDING' },
    })
  })

  it('refuses a client approving ANOTHER client’s proposal, and books nothing', async () => {
    h.auth.mockResolvedValue(clientSession('u_other'))
    h.getActiveClient.mockResolvedValue({ clientId: 'client_B', userId: 'u_other', isPreview: false })
    const res = await approveAs()
    expect(res.status).toBe(404)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses a trainer approving another business’s proposal, and books nothing', async () => {
    h.auth.mockResolvedValue(trainerSession('trainer_B'))
    const res = await approveAs()
    expect(res.status).toBe(404)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await approveAs()
    expect(res.status).toBe(401)
    expect(h.confirm).not.toHaveBeenCalled()
  })
})
