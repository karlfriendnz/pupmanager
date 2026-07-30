import { describe, it, expect, vi, beforeEach } from 'vitest'

// One person, two hats.
//
// A trainer is often somebody else's client — they train dogs for a living and
// take their own dog to a specialist. Karen Backhouse owns Guiding Paws AND is
// a client of Mersea Mutts, and could reach only the business she owns:
// getActiveClient branched on `User.role`, and for a TRAINER returned null
// unless a PREVIEW cookie was set. So the client app bounced her to /login.
//
// The security property that must survive the fix: a TRAINER resolving their
// own client side may only ever land on a profile whose userId is theirs. The
// role was never the boundary — the userId filter is.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieGet: vi.fn(),
  clientFindFirst: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: h.cookieGet }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { clientProfile: { findFirst: h.clientFindFirst, findMany: vi.fn().mockResolvedValue([]) } },
}))
// React cache() is a no-op passthrough outside a request scope.
vi.mock('react', async (orig) => ({
  ...(await orig() as object),
  cache: <T,>(fn: T) => fn,
}))

import { getActiveClient } from '@/lib/client-context'

const TRAINER_SESSION = { user: { id: 'user_karen', role: 'TRAINER', trainerId: 'guiding_paws' } }
const CLIENT_SESSION = { user: { id: 'user_dog_owner', role: 'CLIENT' } }

beforeEach(() => {
  vi.clearAllMocks()
  h.cookieGet.mockReturnValue(undefined)
})

describe('a trainer who is also somebody else’s client', () => {
  it('resolves their OWN client profile instead of being turned away', async () => {
    h.auth.mockResolvedValue(TRAINER_SESSION)
    h.clientFindFirst.mockResolvedValue({ id: 'cp_mersea', userId: 'user_karen' })

    const active = await getActiveClient()

    expect(active, 'a dual-profile trainer must reach the client app').not.toBeNull()
    expect(active?.clientId).toBe('cp_mersea')
    // Not a preview — this is genuinely her own account with another trainer.
    expect(active?.isPreview).toBe(false)
  })

  it('only ever looks up profiles belonging to the signed-in user', async () => {
    h.auth.mockResolvedValue(TRAINER_SESSION)
    h.clientFindFirst.mockResolvedValue({ id: 'cp_mersea', userId: 'user_karen' })

    await getActiveClient()

    // THE security assertion. Every lookup on the own-client path must be
    // scoped by userId; without it a trainer could pin any client's profile id
    // in a cookie and read someone else's account.
    for (const call of h.clientFindFirst.mock.calls) {
      expect(call[0]?.where?.userId, 'every own-client lookup is scoped to the user').toBe('user_karen')
    }
  })

  it('still previews a client of their OWN business when the preview cookie is set', async () => {
    h.auth.mockResolvedValue(TRAINER_SESSION)
    h.cookieGet.mockImplementation((name: string) =>
      name === 'pm-preview-client' ? { value: 'cp_theirs' } : undefined)
    h.clientFindFirst.mockResolvedValue({ id: 'cp_theirs', userId: 'someone_else' })

    const active = await getActiveClient()

    expect(active?.isPreview, 'preview is unchanged').toBe(true)
    // Preview is scoped by trainerId — a trainer may only preview their own clients.
    expect(h.clientFindFirst.mock.calls[0][0]?.where?.trainerId).toBe('guiding_paws')
  })

  it('returns null for a trainer who is nobody’s client', async () => {
    h.auth.mockResolvedValue(TRAINER_SESSION)
    h.clientFindFirst.mockResolvedValue(null)

    expect(await getActiveClient()).toBeNull()
  })
})

describe('an ordinary client is unaffected', () => {
  it('resolves their most recent profile', async () => {
    h.auth.mockResolvedValue(CLIENT_SESSION)
    h.clientFindFirst.mockResolvedValue({ id: 'cp_only', userId: 'user_dog_owner' })

    const active = await getActiveClient()

    expect(active?.clientId).toBe('cp_only')
    expect(active?.isPreview).toBe(false)
  })
})
