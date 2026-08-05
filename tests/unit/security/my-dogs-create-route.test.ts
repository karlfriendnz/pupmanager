import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/dogs — a dog owner adds one of their own dogs from /my-dogs.
//
// Two things this route must never get wrong:
//   · TENANCY — the owning profile comes from the session (getActiveClient),
//     never from the request. A body carrying clientProfileId must be ignored.
//   · VALIDATION — the add form's `required` / `max` attributes are decoration
//     (AGENTS.md bug #3). Everything the form refuses, the route refuses.
//
// Prisma and the client context are mocked — no DB.
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  dogCreate: vi.fn(),
  clientProfileUpdateMany: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dog: { create: h.dogCreate },
    clientProfile: { updateMany: h.clientProfileUpdateMany },
  },
}))

import { POST } from '@/app/api/my/dogs/route'

const MINE = 'cp-mine'
const THEIRS = 'cp-someone-else'

function req(body: unknown) {
  return new Request('http://localhost/api/my/dogs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** The signed-in dog owner, working with their own trainer. */
function signedIn() {
  h.getActiveClient.mockResolvedValue({ clientId: MINE, userId: 'u-1', isPreview: false, actualUserId: 'u-1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dogCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'dog-new', ...data }))
  h.clientProfileUpdateMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/my/dogs — tenancy', () => {
  it('401 when there is no active client (signed out)', async () => {
    h.getActiveClient.mockResolvedValue(null)
    const res = await POST(req({ name: 'Bailey' }))
    expect(res.status).toBe(401)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('403 in trainer preview mode — looking through a client’s eyes is read-only', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: MINE, userId: 'u-1', isPreview: true, actualUserId: 'trainer-9' })
    const res = await POST(req({ name: 'Bailey' }))
    expect(res.status).toBe(403)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('ignores a clientProfileId in the body — the dog lands on the caller’s own profile', async () => {
    signedIn()
    const res = await POST(req({ name: 'Bailey', clientProfileId: THEIRS, id: 'forged-id' }))
    expect(res.status).toBe(201)
    const data = h.dogCreate.mock.calls[0][0].data
    expect(data.clientProfileId).toBe(MINE)
    expect(data).not.toHaveProperty('id')
    // And the primary-dog backfill is scoped to the caller's profile too.
    expect(h.clientProfileUpdateMany).toHaveBeenCalledWith({
      where: { id: MINE, dogId: null },
      data: { dogId: 'dog-new' },
    })
  })
})

describe('POST /api/my/dogs — validation', () => {
  beforeEach(signedIn)

  it('201 for the happy path, and every field it accepted comes back', async () => {
    const res = await POST(req({ name: '  Bailey  ', breed: 'Border Collie', weight: 18.5, dob: '2021-04-02' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Bailey') // trimmed
    expect(body.breed).toBe('Border Collie')
    expect(body.weight).toBe(18.5)
    expect(new Date(body.dob).toISOString().slice(0, 10)).toBe('2021-04-02')
  })

  it('201 with only a name — the rest is optional and stored as null', async () => {
    const res = await POST(req({ name: 'Milo' }))
    expect(res.status).toBe(201)
    const data = h.dogCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ name: 'Milo', breed: null, weight: null, dob: null })
  })

  it('400 when name is missing', async () => {
    const res = await POST(req({ breed: 'Poodle' }))
    expect(res.status).toBe(400)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('400 when name is only whitespace — trimmed BEFORE the length check', async () => {
    const res = await POST(req({ name: '   ' }))
    expect(res.status).toBe(400)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('400 when name is absurdly long', async () => {
    const res = await POST(req({ name: 'B'.repeat(81) }))
    expect(res.status).toBe(400)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('400 for a zero, negative or impossible weight', async () => {
    for (const weight of [0, -5, 201]) {
      h.dogCreate.mockClear()
      const res = await POST(req({ name: 'Bailey', weight }))
      expect(res.status, `weight ${weight}`).toBe(400)
      expect(h.dogCreate).not.toHaveBeenCalled()
    }
  })

  it('400 when weight is a string rather than a number', async () => {
    const res = await POST(req({ name: 'Bailey', weight: '18' }))
    expect(res.status).toBe(400)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('400 for a malformed or future date of birth', async () => {
    for (const dob of ['not-a-date', '02/04/2021', '2099-01-01', '1899-01-01']) {
      h.dogCreate.mockClear()
      const res = await POST(req({ name: 'Bailey', dob }))
      expect(res.status, `dob ${dob}`).toBe(400)
      expect(h.dogCreate).not.toHaveBeenCalled()
    }
  })

  it('400 when the body is not JSON at all', async () => {
    const res = await POST(new Request('http://localhost/api/my/dogs', { method: 'POST', body: 'nope' }))
    expect(res.status).toBe(400)
    expect(h.dogCreate).not.toHaveBeenCalled()
  })

  it('an empty breed string is stored as null, not as ""', async () => {
    const res = await POST(req({ name: 'Bailey', breed: '   ' }))
    expect(res.status).toBe(201)
    expect(h.dogCreate.mock.calls[0][0].data.breed).toBeNull()
  })
})

describe('POST /api/my/dogs — the primary-dog backfill', () => {
  beforeEach(signedIn)

  it('claims the primary slot only while it is still empty', async () => {
    await POST(req({ name: 'Bailey' }))
    // `updateMany` with `dogId: null` in the WHERE is what stops a second dog
    // stealing the spot — a plain update would overwrite it.
    expect(h.clientProfileUpdateMany).toHaveBeenCalledWith({
      where: { id: MINE, dogId: null },
      data: { dogId: 'dog-new' },
    })
  })
})
