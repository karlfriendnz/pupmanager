import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/my/join-requests — a dog owner asking a trainer to add them.
//
// Tenancy is the whole test. The acting person is read from the SESSION and
// never from the body, so:
//   • a signed-out caller gets 401
//   • a body carrying someone else's userId/email is ignored
//   • GET can only ever return the caller's own outstanding requests
//
// And the functional half: it must never write a ClientProfile. A public-ish
// request that put the requester straight onto a trainer's books would let
// anyone add themselves to a business record.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  notifyEnquiryTrainer: vi.fn(),
  userFindUnique: vi.fn(),
  trainerFindFirst: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  clientProfileCreate: vi.fn(),
  enquiryFindFirst: vi.fn(),
  enquiryFindMany: vi.fn(),
  enquiryCreate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/notify-enquiry-trainer', () => ({ notifyEnquiryTrainer: h.notifyEnquiryTrainer }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    trainerProfile: { findFirst: h.trainerFindFirst },
    clientProfile: { findUnique: h.clientProfileFindUnique, create: h.clientProfileCreate },
    enquiry: { findFirst: h.enquiryFindFirst, findMany: h.enquiryFindMany, create: h.enquiryCreate },
  },
}))

import { GET, POST } from '@/app/api/my/join-requests/route'

const req = (b: unknown) =>
  new Request('https://app.pupmanager.com/api/my/join-requests', {
    method: 'POST',
    body: JSON.stringify(b),
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.auth.mockResolvedValue({ user: { id: 'me', role: 'CLIENT', email: 'me@example.test' } })
  h.enforceRateLimit.mockResolvedValue(null)
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.notifyEnquiryTrainer.mockResolvedValue(undefined)
  h.userFindUnique.mockResolvedValue({ id: 'me', name: 'Me', email: 'me@example.test' })
  h.trainerFindFirst.mockResolvedValue({ id: 'trainer-1' })
  h.clientProfileFindUnique.mockResolvedValue(null)
  h.enquiryFindFirst.mockResolvedValue(null)
  h.enquiryFindMany.mockResolvedValue([])
  h.enquiryCreate.mockResolvedValue({ id: 'enq-1' })
})

describe('POST /api/my/join-requests — tenancy', () => {
  it('401s when signed out', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ trainerId: 'trainer-1' }))
    expect(res.status).toBe(401)
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })

  it('ignores a userId/email in the body and acts as the session user', async () => {
    await POST(req({ trainerId: 'trainer-1', userId: 'victim', email: 'victim@example.test' }))
    // The identity used is the session's, resolved through prisma by id.
    expect(h.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'me' } }),
    )
    expect(h.enquiryCreate.mock.calls[0][0].data.email).toBe('me@example.test')
  })

  it('never writes a ClientProfile — only a request the trainer approves', async () => {
    await POST(req({ trainerId: 'trainer-1' }))
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
    expect(h.enquiryCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: 'trainer-1',
      source: 'SELF_SIGNUP',
    })
    expect(h.notifyEnquiryTrainer).toHaveBeenCalledWith({ enquiryId: 'enq-1' })
  })

  it('404s an unknown or deactivated trainer', async () => {
    h.trainerFindFirst.mockResolvedValue(null)
    const res = await POST(req({ trainerId: 'someone-elses' }))
    expect(res.status).toBe(404)
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })

  it('does not re-notify (or duplicate) an outstanding request', async () => {
    h.enquiryFindFirst.mockResolvedValue({ id: 'enq-existing' })
    const res = await POST(req({ trainerId: 'trainer-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pending: true, enquiryId: 'enq-existing' })
    expect(h.enquiryCreate).not.toHaveBeenCalled()
    expect(h.notifyEnquiryTrainer).not.toHaveBeenCalled()
  })

  it('reports alreadyClient instead of raising a request when the trainer already has them', async () => {
    h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1' })
    const res = await POST(req({ trainerId: 'trainer-1' }))
    expect(await res.json()).toMatchObject({ alreadyClient: true })
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })
})

describe('GET /api/my/join-requests — tenancy', () => {
  it('401s when signed out', async () => {
    h.auth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('scopes the lookup to the caller’s own email', async () => {
    await GET()
    expect(h.enquiryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'me@example.test', status: 'NEW' } }),
    )
  })
})
