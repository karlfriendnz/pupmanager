import { describe, it, expect, vi, beforeEach } from 'vitest'

// The two rollout gates on TrainerProfile — recurringPaymentsEnabled and
// tapToPayEnabled — and the one route allowed to move them.
//
// Both switch on something that takes a client's money: a monthly Stripe
// Subscription in one case, a stranger's card tapped on a phone in the other.
// Neither is a preference, so neither belongs on any trainer-facing endpoint;
// this admin PATCH is the only writer, and it is the only writer on purpose.
// The check that matters is the negative one — a trainer session must not be
// able to switch its own business into a rollout.
const { mockAuth, mockUserFind, mockUserUpdate, mockProfileUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFind: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockProfileUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFind, update: mockUserUpdate },
    trainerProfile: { update: mockProfileUpdate },
  },
}))

import { PATCH } from '@/app/api/admin/trainers/[trainerId]/route'

const params = Promise.resolve({ trainerId: 'tr_1' })
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/admin/trainers/tr_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params },
  )

const GATES = ['tapToPayEnabled', 'recurringPaymentsEnabled'] as const

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: 'ADMIN', id: 'u_admin' } })
  mockUserFind.mockResolvedValue({ id: 'tr_1', email: 'a@b.com' })
  mockUserUpdate.mockResolvedValue({})
  mockProfileUpdate.mockResolvedValue({})
})

describe.each(GATES)('PATCH /api/admin/trainers/[trainerId] — %s', (gate) => {
  it('an admin switches it on for one named business', async () => {
    const res = await patch({ [gate]: true })
    expect(res.status).toBe(200)
    expect(mockProfileUpdate.mock.calls[0][0].data[gate]).toBe(true)
    expect(
      mockProfileUpdate.mock.calls[0][0].where.userId,
      'the gate is set on the trainer named in the URL and nobody else',
    ).toBe('tr_1')
  })

  it('and switches it back off', async () => {
    await patch({ [gate]: false })
    expect(mockProfileUpdate.mock.calls[0][0].data[gate]).toBe(false)
  })

  it('leaves it alone when the request does not mention it', async () => {
    // Every other admin action PATCHes this same route. If an omitted gate read
    // as false, saving a trainer's name would quietly switch their rollout off.
    await patch({ businessName: 'Paws & Thrive' })
    expect(mockProfileUpdate.mock.calls[0][0].data).not.toHaveProperty(gate)
  })

  it('rejects a non-boolean rather than coercing it', async () => {
    const res = await patch({ [gate]: 'yes' })
    expect(res.status).toBe(400)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('refuses a trainer trying to switch their own business on', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'TRAINER', id: 'tr_1' } })
    expect((await patch({ [gate]: true })).status).toBe(401)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await patch({ [gate]: true })).status).toBe(401)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('404s for a trainer who does not exist', async () => {
    mockUserFind.mockResolvedValue(null)
    expect((await patch({ [gate]: true })).status).toBe(404)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })
})
