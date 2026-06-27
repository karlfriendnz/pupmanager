import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/dogs/[dogId]/photo — upload a dog's photo. Both clients (dog
// owners) and the owning trainer can call it. Security focus: only the dog's
// own client, or a trainer in the owning business (or a CO_MANAGE share), may
// write; plus the size/type/missing-file guards. Blob + Prisma are mocked —
// no network, no DB.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  dogFindUnique: vi.fn(),
  dogUpdate: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  clientProfileFindFirst: vi.fn(),
  clientShareFindFirst: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dog: { findUnique: h.dogFindUnique, update: h.dogUpdate },
    clientProfile: { findUnique: h.clientProfileFindUnique, findFirst: h.clientProfileFindFirst },
    clientShare: { findFirst: h.clientShareFindFirst },
  },
}))
vi.mock('@vercel/blob', () => ({ put: h.put }))

import { POST } from '@/app/api/dogs/[dogId]/photo/route'

const DOG_ID = 'dog-1'
const params = Promise.resolve({ dogId: DOG_ID })

// A primary dog owned by client profile cp-1 in trainer/business t-1.
function seedPrimaryDog() {
  h.dogFindUnique.mockResolvedValue({
    id: DOG_ID,
    clientProfileId: null,
    primaryFor: [{ id: 'cp-1', trainerId: 't-1' }],
  })
}

function reqWith(file: File | null) {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request('http://localhost/api/dogs/dog-1/photo', { method: 'POST', body: fd })
}

function imageFile(bytes = 1024, type = 'image/jpeg', name = 'pup.jpg') {
  return new File([new Uint8Array(bytes)], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.put.mockResolvedValue({ url: 'https://blob.example/dog-photos/cp-1/dog-1/uuid.jpg' })
  h.dogUpdate.mockImplementation(async ({ data }: { data: { photoUrl: string } }) => ({ id: DOG_ID, photoUrl: data.photoUrl }))
})

describe('POST /api/dogs/[dogId]/photo', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(reqWith(imageFile()), { params })
    expect(res.status).toBe(401)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('404 when the dog does not exist', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
    h.dogFindUnique.mockResolvedValue(null)
    const res = await POST(reqWith(imageFile()), { params })
    expect(res.status).toBe(404)
  })

  it('403 when a client does not own the dog', async () => {
    h.auth.mockResolvedValue({ user: { id: 'intruder', role: 'CLIENT' } })
    seedPrimaryDog()
    h.clientProfileFindFirst.mockResolvedValue(null) // not their profile
    const res = await POST(reqWith(imageFile()), { params })
    expect(res.status).toBe(403)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('403 when a trainer from another business with no share calls', async () => {
    h.auth.mockResolvedValue({ user: { id: 'other-trainer', role: 'TRAINER', trainerId: 't-2' } })
    seedPrimaryDog()
    h.clientShareFindFirst.mockResolvedValue(null) // no CO_MANAGE share
    const res = await POST(reqWith(imageFile()), { params })
    expect(res.status).toBe(403)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('the owning client can upload — persists photoUrl under a scoped path', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
    seedPrimaryDog()
    h.clientProfileFindFirst.mockResolvedValue({ id: 'cp-1' })
    const res = await POST(reqWith(imageFile()), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.photoUrl).toContain('dog-photos/')
    // Path is tenant-scoped to the owning client profile + dog, never client input.
    expect(h.put.mock.calls[0][0]).toMatch(/^dog-photos\/cp-1\/dog-1\//)
    expect(h.dogUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DOG_ID } }))
  })

  it('400 when no file is attached', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
    seedPrimaryDog()
    h.clientProfileFindFirst.mockResolvedValue({ id: 'cp-1' })
    const res = await POST(reqWith(null), { params })
    expect(res.status).toBe(400)
  })

  it('413 when the image exceeds 10 MB', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
    seedPrimaryDog()
    h.clientProfileFindFirst.mockResolvedValue({ id: 'cp-1' })
    const res = await POST(reqWith(imageFile(11 * 1024 * 1024)), { params })
    expect(res.status).toBe(413)
    expect(h.put).not.toHaveBeenCalled()
  })

  it('415 for an unsupported file type', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-1', role: 'CLIENT' } })
    seedPrimaryDog()
    h.clientProfileFindFirst.mockResolvedValue({ id: 'cp-1' })
    const res = await POST(reqWith(imageFile(1024, 'application/pdf', 'x.pdf')), { params })
    expect(res.status).toBe(415)
    expect(h.put).not.toHaveBeenCalled()
  })
})
