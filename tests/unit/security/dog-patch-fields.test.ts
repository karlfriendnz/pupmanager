import { describe, it, expect, vi, beforeEach } from 'vitest'

// PATCH /api/dogs/[dogId] — the edit half of the /my-dogs screen (the fields
// that used to live on My Profile's Dogs tab). Same contract as the create
// route: an IDOR guard on the dog, and the same bounds the form shows.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  clientProfileFindMany: vi.fn(),
  dogUpdate: vi.fn(),
  belongs: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/dog-access', () => ({ dogBelongsToAnyClient: h.belongs }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findMany: h.clientProfileFindMany, updateMany: vi.fn() },
    dog: { update: h.dogUpdate, delete: vi.fn() },
  },
}))

import { PATCH } from '@/app/api/dogs/[dogId]/route'

const params = Promise.resolve({ dogId: 'dog-1' })

function req(body: unknown) {
  return new Request('http://localhost/api/dogs/dog-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
  h.clientProfileFindMany.mockResolvedValue([{ id: 'cp-mine' }])
  h.belongs.mockResolvedValue(true)
  h.dogUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'dog-1', ...data }))
})

describe('PATCH /api/dogs/[dogId]', () => {
  it('401 when signed out', async () => {
    h.auth.mockResolvedValue(null)
    const res = await PATCH(req({ name: 'Bailey' }), { params })
    expect(res.status).toBe(401)
    expect(h.dogUpdate).not.toHaveBeenCalled()
  })

  it('404 when the dog belongs to somebody else', async () => {
    h.belongs.mockResolvedValue(false)
    const res = await PATCH(req({ name: 'Bailey' }), { params })
    expect(res.status).toBe(404)
    expect(h.dogUpdate).not.toHaveBeenCalled()
  })

  it('saves name, breed, weight and date of birth', async () => {
    const res = await PATCH(req({ name: 'Bailey', breed: 'Border Collie', weight: 18.5, dob: '2021-04-02' }), { params })
    expect(res.status).toBe(200)
    const data = h.dogUpdate.mock.calls[0][0].data
    expect(data.name).toBe('Bailey')
    expect(data.breed).toBe('Border Collie')
    expect(data.weight).toBe(18.5)
    expect((data.dob as Date).toISOString().slice(0, 10)).toBe('2021-04-02')
  })

  it('a null breed / weight / dob clears the field rather than being dropped', async () => {
    const res = await PATCH(req({ breed: null, weight: null, dob: null }), { params })
    expect(res.status).toBe(200)
    expect(h.dogUpdate.mock.calls[0][0].data).toMatchObject({ breed: null, weight: null, dob: null })
  })

  it('leaves dob untouched when the patch omits it (AGENTS.md bug #1)', async () => {
    await PATCH(req({ name: 'Bailey' }), { params })
    expect(h.dogUpdate.mock.calls[0][0].data).not.toHaveProperty('dob')
  })

  it('400 for an empty name, an impossible weight or a future dob', async () => {
    for (const body of [{ name: '   ' }, { weight: 0 }, { weight: 201 }, { dob: '2099-01-01' }, { dob: '3/4/21' }]) {
      h.dogUpdate.mockClear()
      const res = await PATCH(req(body), { params })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(h.dogUpdate).not.toHaveBeenCalled()
    }
  })
})
