import { describe, it, expect, vi, beforeEach } from 'vitest'

// The question every client-screen write to a shared User row has to ask first:
// does this person run a business here?
//
// There are TWO ways to hold an account, and the first version of this check only
// knew about one. A membership row is the modern answer, but every account made
// before the team feature has none — getTrainerContext calls them "legacy owners"
// and reads the role off the TrainerProfile instead. So a membership-only check
// passed for the platform's oldest businesses, and a client edit renamed one of
// them: its outbound email went out signed with a client's name.

const h = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
  profileFindFirst: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findFirst: h.membershipFindFirst, findUnique: vi.fn() },
    trainerProfile: { findFirst: h.profileFindFirst },
  },
}))

import { ownsATrainerAccount } from '@/lib/membership'

beforeEach(() => {
  vi.clearAllMocks()
  h.membershipFindFirst.mockResolvedValue(null)
  h.profileFindFirst.mockResolvedValue(null)
})

describe('ownsATrainerAccount', () => {
  it('is true for a staff member or owner with a membership row', async () => {
    h.membershipFindFirst.mockResolvedValue({ id: 'tm_1' })
    expect(await ownsATrainerAccount('u_1')).toBe(true)
  })

  // The case that got a real business renamed.
  it('is true for a legacy owner who has a profile but NO membership', async () => {
    h.membershipFindFirst.mockResolvedValue(null)
    h.profileFindFirst.mockResolvedValue({ id: 'tr_1' })
    expect(await ownsATrainerAccount('u_1')).toBe(true)
  })

  it('is false for an ordinary client', async () => {
    expect(await ownsATrainerAccount('u_1')).toBe(false)
  })

  it('asks about the user it was given', async () => {
    await ownsATrainerAccount('u_target')
    expect(h.membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u_target' } }),
    )
    expect(h.profileFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u_target' } }),
    )
  })
})
