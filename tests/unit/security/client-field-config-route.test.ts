import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/clients/field-config — returns the calling company's built-in field
// config + custom fields, used by the quick-add modal. Security focus: must be
// an authenticated trainer, and every lookup is scoped to the caller's own
// company id (no cross-tenant read).
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  customFieldFindMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    customField: { findMany: h.customFieldFindMany },
  },
}))

import { GET } from '@/app/api/clients/field-config/route'

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.trainerProfileFindUnique.mockResolvedValue({ clientFieldConfig: null })
  h.customFieldFindMany.mockResolvedValue([])
})

describe('GET /api/clients/field-config — auth', () => {
  it('rejects an unauthenticated / non-trainer caller with 401', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.trainerProfileFindUnique).not.toHaveBeenCalled()
    expect(h.customFieldFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/clients/field-config — company scoping', () => {
  // It used to serve a per-company config for the built-in details as well; that
  // is gone, so the only lookup left is the custom fields — and it still has to be
  // scoped to the caller's own company.
  it('scopes the lookup to the caller’s own company id', async () => {
    h.getTrainerContext.mockResolvedValue({ companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.customFieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'company-A' } }),
    )
  })

  it('cannot be steered to another company — it never reads the body', async () => {
    // GET takes no arguments; the company is derived entirely from the session
    // context. There is no parameter an attacker could supply.
    h.getTrainerContext.mockResolvedValue({ companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'STAFF', permissions: {} })
    await GET()
    expect(h.customFieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'company-A' } }),
    )
    expect(h.customFieldFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'company-B' } }),
    )
  })

  it('maps custom fields through with their flags', async () => {
    h.getTrainerContext.mockResolvedValue({ companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} })
    h.customFieldFindMany.mockResolvedValue([
      { id: 'cf1', label: 'Goal', type: 'TEXT', options: null, required: true, inQuickAdd: false, appliesTo: 'OWNER' },
    ])
    const res = await GET()
    const body = await res.json()
    expect(body.customFields).toEqual([
      { id: 'cf1', label: 'Goal', type: 'TEXT', options: [], required: true, inQuickAdd: false, appliesTo: 'OWNER' },
    ])
  })
})
