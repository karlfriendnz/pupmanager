import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockProfileCount, mockMemberCount, mockClientCount } = vi.hoisted(() => ({
  mockProfileCount: vi.fn(),
  mockMemberCount: vi.fn(),
  mockClientCount: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { count: mockProfileCount },
    trainerMembership: { count: mockMemberCount },
    clientProfile: { count: mockClientCount },
  },
}))

import { getAccountAccess, canUseProfile, resolveProfileSide } from '@/lib/account-access'

const setup = ({ own = 0, memberships = 0, clients = 0 }) => {
  mockProfileCount.mockResolvedValue(own)
  mockMemberCount.mockResolvedValue(memberships)
  mockClientCount.mockResolvedValue(clients)
}

beforeEach(() => vi.clearAllMocks())

describe('getAccountAccess', () => {
  it('a business owner has trainer access only', async () => {
    setup({ own: 1 })
    expect(await getAccountAccess('u')).toEqual({ hasTrainerAccess: true, hasClientAccess: false, isDual: false })
  })

  it('a plain client has client access only', async () => {
    setup({ clients: 2 })
    expect(await getAccountAccess('u')).toEqual({ hasTrainerAccess: false, hasClientAccess: true, isDual: false })
  })

  // The case this feature exists for: owns a business, contracts for another,
  // and is somebody else's client — all on one login.
  it('an owner who contracts elsewhere AND is a client is dual', async () => {
    setup({ own: 1, memberships: 2, clients: 1 })
    const a = await getAccountAccess('u')
    expect(a).toEqual({ hasTrainerAccess: true, hasClientAccess: true, isDual: true })
  })

  it('a client who contracts for a business gains trainer access', async () => {
    setup({ own: 0, memberships: 1, clients: 1 })
    expect((await getAccountAccess('u')).hasTrainerAccess).toBe(true)
  })

  // A pending invite must not unlock the trainer app before acceptance.
  it('only counts ACCEPTED memberships', async () => {
    setup({ memberships: 0 })
    await getAccountAccess('u')
    expect(mockMemberCount).toHaveBeenCalledWith({
      where: { userId: 'u', acceptedAt: { not: null } },
    })
  })
})

describe('canUseProfile', () => {
  it('refuses a side the user has no relationship for', async () => {
    setup({ own: 1 })
    expect(await canUseProfile('u', 'trainer')).toBe(true)
    expect(await canUseProfile('u', 'client')).toBe(false)
  })
})

describe('resolveProfileSide', () => {
  const dual = { hasTrainerAccess: true, hasClientAccess: true, isDual: true }
  const trainerOnly = { hasTrainerAccess: true, hasClientAccess: false, isDual: false }
  const clientOnly = { hasTrainerAccess: false, hasClientAccess: true, isDual: false }

  it('honours the cookie when the side is reachable', () => {
    expect(resolveProfileSide(dual, 'client')).toBe('client')
    expect(resolveProfileSide(dual, 'trainer')).toBe('trainer')
  })

  // A forged/stale cookie must never grant a side they can't reach.
  it('ignores a cookie naming an unreachable side', () => {
    expect(resolveProfileSide(trainerOnly, 'client')).toBe('trainer')
    expect(resolveProfileSide(clientOnly, 'trainer')).toBe('client')
  })

  it('defaults to the trainer surface when both are available', () => {
    expect(resolveProfileSide(dual, undefined)).toBe('trainer')
  })

  it('returns null when they can reach neither', () => {
    expect(resolveProfileSide({ hasTrainerAccess: false, hasClientAccess: false, isDual: false }, 'trainer')).toBeNull()
  })
})
