import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lead-magnet management API. Security focus: the 'leadmagnets' add-on gate,
// and that update/delete are tenant-scoped (a trainer can't touch another
// company's magnet — the owned-lookup filters by companyId).
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  uniqueSlug: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/prisma', () => ({
  prisma: { leadMagnet: { findMany: h.findMany, create: h.create, findFirst: h.findFirst, update: h.update, delete: h.del } },
}))
vi.mock('@/lib/lead-magnet', () => ({ uniqueLeadMagnetSlug: h.uniqueSlug, DEFAULT_CONSENT_TEXT: 'default consent' }))

import { POST as CREATE, GET as LIST } from '@/app/api/trainer/lead-magnets/route'
import { PATCH, DELETE } from '@/app/api/trainer/lead-magnets/[id]/route'

function grant(companyId = 'company-A') {
  h.guardPermission.mockResolvedValue({ companyId, userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} })
}
function body(b: unknown) {
  return new Request('http://localhost/api/trainer/lead-magnets', { method: 'POST', body: JSON.stringify(b) })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.uniqueSlug.mockResolvedValue('puppy-tips')
})

describe('lead-magnets management API — add-on gate', () => {
  it('GET 403s when the add-on is off', async () => {
    grant(); h.hasAddon.mockResolvedValue(false)
    const res = await LIST()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADDON_REQUIRED')
  })

  it('POST 403s when the add-on is off', async () => {
    grant(); h.hasAddon.mockResolvedValue(false)
    const res = await CREATE(body({ title: 'X', fileUrl: 'https://b/x.pdf', fileName: 'x.pdf' }))
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('POST creates under the caller company when the add-on is on', async () => {
    grant('company-A'); h.hasAddon.mockResolvedValue(true)
    h.create.mockResolvedValue({ id: 'lm1', slug: 'puppy-tips', title: 'X' })
    const res = await CREATE(body({ title: 'X', fileUrl: 'https://b/x.pdf', fileName: 'x.pdf' }))
    expect(res.status).toBe(201)
    expect(h.create.mock.calls[0][0].data.trainerId).toBe('company-A') // from ctx, never the body
  })
})

describe('lead-magnets management API — cross-tenant', () => {
  const params = Promise.resolve({ id: 'lm-of-B' })

  it('PATCH 404s for a magnet the caller does not own', async () => {
    grant('company-A'); h.hasAddon.mockResolvedValue(true)
    h.findFirst.mockResolvedValue(null) // not found under company-A
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ title: 'pwn' }) }), { params })
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
    // The owned-lookup must be scoped by the caller's company.
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: 'lm-of-B', trainerId: 'company-A' })
  })

  it('DELETE 404s for a magnet the caller does not own', async () => {
    grant('company-A'); h.hasAddon.mockResolvedValue(true)
    h.findFirst.mockResolvedValue(null)
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), { params })
    expect(res.status).toBe(404)
    expect(h.del).not.toHaveBeenCalled()
  })
})
