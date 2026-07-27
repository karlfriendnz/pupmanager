import { describe, it, expect, vi, beforeEach } from 'vitest'

// The redirect loop this fixes:
//
//   a dog owner signs themselves up  ->  User(CLIENT) with no ClientProfile yet
//   /home -> (client) layout can't resolve a profile -> /login
//   /login -> already signed in -> / -> role CLIENT -> /home -> ...
//
// A ClientProfile requires a trainerId, so "account exists, no profile" is a
// real, expected state between signing up and being accepted. It has to land
// somewhere that explains itself.
//
// The decision is made on ACCESS, not on `role`, so it survives the follow-up
// work that lets one login be both a trainer and a client.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getAccountAccess: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/account-access', () => ({ getAccountAccess: h.getAccountAccess, PROFILE_COOKIE: 'pm-profile' }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { clientProfile: { findFirst: vi.fn(), findMany: vi.fn() } } }))

import { noActiveClientDestination } from '@/lib/client-context'

const access = (over: Partial<{ hasTrainerAccess: boolean; hasClientAccess: boolean }> = {}) => ({
  hasTrainerAccess: false,
  hasClientAccess: false,
  isDual: false,
  ...over,
})

beforeEach(() => {
  h.auth.mockReset()
  h.getAccountAccess.mockReset()
})

describe('noActiveClientDestination', () => {
  it('sends a signed-out visitor to /login (unchanged)', async () => {
    h.auth.mockResolvedValue(null)
    expect(await noActiveClientDestination()).toBe('/login')
  })

  it('sends a dog owner with no trainer yet to the waiting room, not back to /login', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'CLIENT' } })
    h.getAccountAccess.mockResolvedValue(access())
    expect(await noActiveClientDestination()).toBe('/find-trainer')
  })

  it('keeps /login for a trainer with a stale preview cookie', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2', role: 'TRAINER' } })
    h.getAccountAccess.mockResolvedValue(access({ hasTrainerAccess: true }))
    expect(await noActiveClientDestination()).toBe('/login')
  })

  it('keeps /login for someone who does have client access (a stale active-trainer cookie)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u3', role: 'CLIENT' } })
    h.getAccountAccess.mockResolvedValue(access({ hasClientAccess: true }))
    expect(await noActiveClientDestination()).toBe('/login')
  })
})
