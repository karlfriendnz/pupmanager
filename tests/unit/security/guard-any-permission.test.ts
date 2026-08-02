import { describe, it, expect, vi, beforeEach } from 'vitest'

// guardAnyPermission, added for tags.
//
// Tags sit across two catalogues at once, so the tag list has to open for a
// staff member who manages EITHER — but for nobody who manages neither. The
// "either" half is the easy one to get right and the "neither" half is the one
// that quietly turns a guard into decoration, so both are asserted.
const h = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn() }))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerMembership: { findUnique: h.findUnique } },
}))
// getTrainerContext is React-cached; without a request scope the real cache()
// would memoise across cases and every test after the first would see the
// first one's member.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, cache: (fn: unknown) => fn }
})

import { guardAnyPermission } from '@/lib/membership'

const TRAINER = 'trainer_1'

beforeEach(() => {
  h.auth.mockReset()
  h.findUnique.mockReset()
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER, id: 'user_1' } })
})

describe('guardAnyPermission', () => {
  it('lets a shop-only staff member through on products.manage', async () => {
    h.findUnique.mockResolvedValue({ id: 'm1', role: 'STAFF', permissions: { 'products.manage': true } })

    const guard = await guardAnyPermission('packages.manage', 'products.manage')

    expect(guard).not.toBeInstanceOf(Response)
    expect((guard as { companyId: string }).companyId).toBe(TRAINER)
  })

  it('lets an offerings-only staff member through on packages.manage', async () => {
    h.findUnique.mockResolvedValue({ id: 'm2', role: 'STAFF', permissions: { 'packages.manage': true } })

    const guard = await guardAnyPermission('packages.manage', 'products.manage')

    expect(guard).not.toBeInstanceOf(Response)
  })

  it('403s a staff member who manages neither catalogue', async () => {
    h.findUnique.mockResolvedValue({ id: 'm3', role: 'STAFF', permissions: { 'clients.edit': true } })

    const guard = await guardAnyPermission('packages.manage', 'products.manage')

    expect(guard).toBeInstanceOf(Response)
    expect((guard as Response).status).toBe(403)
  })

  it('401s when nobody is signed in', async () => {
    h.auth.mockResolvedValue(null)

    const guard = await guardAnyPermission('packages.manage', 'products.manage')

    expect((guard as Response).status).toBe(401)
  })
})
