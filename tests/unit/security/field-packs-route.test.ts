import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Guards + input trust on POST /api/custom-fields/packs (starter field packs).
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  getTrainerContext: vi.fn(),
  fieldFindMany: vi.fn(),
  createMany: vi.fn(),
  profileFindUnique: vi.fn(),
  profileUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  guardPermission: h.guardPermission,
  getTrainerContext: h.getTrainerContext,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customField: { findMany: h.fieldFindMany, createMany: h.createMany },
    trainerProfile: { findUnique: h.profileFindUnique, update: h.profileUpdate },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/custom-fields/packs/route'

const OWNER_CO = 'co1'

function call(body: unknown) {
  return POST(new Request('https://app.pupmanager.com/api/custom-fields/packs', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.getTrainerContext.mockResolvedValue({ companyId: OWNER_CO, userId: 'u1', role: 'OWNER', permissions: [] })
  h.fieldFindMany.mockResolvedValue([])
  h.profileFindUnique.mockResolvedValue({ intakeSectionOrder: [] })
  h.transaction.mockResolvedValue([])
})

describe('POST /api/custom-fields/packs — guards', () => {
  it('refuses a member without settings.edit', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call({ keys: ['essentials:breed'] })
    expect(res.status).toBe(403)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('refuses a signed-out / company-less caller', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await call({ keys: ['essentials:breed'] })
    expect(res.status).toBe(401)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('writes fields to the CALLER\'s company, never a company from the request', async () => {
    await call({ keys: ['essentials:vet'], trainerId: 'co2' })
    const [ops] = h.transaction.mock.calls[0]
    void ops
    expect(h.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ trainerId: OWNER_CO })]),
      }),
    )
    expect(h.profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OWNER_CO } }),
    )
  })
})

describe('POST /api/custom-fields/packs — input is not trusted', () => {
  it('rejects an empty selection', async () => {
    expect((await call({ keys: [] })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })

  it('refuses a selection of entirely unknown fields', async () => {
    const res = await call({ keys: ['made:up', 'essentials:nope'] })
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('creates from the server catalog, ignoring client-supplied definitions', async () => {
    await call({ keys: ['essentials:vet'], label: 'DROP TABLE', type: 'DROPDOWN' })
    expect(h.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ label: 'Vet clinic', type: 'TEXT', category: 'About your dog' })],
    })
  })

  it('never creates a custom field that duplicates a built-in (Breed / Age)', async () => {
    const res = await call({ keys: ['essentials:breed', 'essentials:age'] })
    expect(res.status).toBe(200)
    expect(h.createMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/custom-fields/packs — behaviour', () => {
  it('skips fields the trainer already has, so a second run is not a duplicate', async () => {
    h.fieldFindMany.mockResolvedValue([{ label: 'breed', order: 0 }])
    const res = await call({ keys: ['essentials:breed', 'essentials:vet'] })
    const body = await res.json()
    expect(body).toMatchObject({ created: 1, skipped: 1 })
    expect(h.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ label: 'Vet clinic' })],
    })
  })

  it('appends each pack\'s section without dropping existing ones', async () => {
    h.profileFindUnique.mockResolvedValue({ intakeSectionOrder: [{ name: 'About you', description: null }] })
    await call({ keys: ['essentials:vet', 'walking:access'] })
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: OWNER_CO },
      data: {
        intakeSectionOrder: [
          { name: 'About you', description: null },
          { name: 'About your dog', description: null },
          { name: 'Walks', description: null },
        ],
      },
    })
  })

  it('continues the existing field order rather than colliding with it', async () => {
    h.fieldFindMany.mockResolvedValue([{ label: 'Existing', order: 7 }])
    await call({ keys: ['essentials:vet'] })
    expect(h.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ order: 8 })],
    })
  })
})
