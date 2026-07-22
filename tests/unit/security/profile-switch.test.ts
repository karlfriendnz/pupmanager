import { describe, it, expect, vi, beforeEach } from 'vitest'

// The pm-profile cookie routes middleware, so setting it must be gated on a
// real relationship. Otherwise anyone could POST {side:'trainer'} and get
// waved past the proxy into the trainer app.
const { mockAuth, mockProfileCount, mockMemberCount, mockClientCount } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockProfileCount: vi.fn(),
  mockMemberCount: vi.fn(),
  mockClientCount: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { count: mockProfileCount },
    trainerMembership: { count: mockMemberCount },
    clientProfile: { count: mockClientCount },
  },
}))

import { POST } from '@/app/api/profile/switch/route'
import { PROFILE_COOKIE } from '@/lib/account-access'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/profile/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

const access = ({ own = 0, memberships = 0, clients = 0 }) => {
  mockProfileCount.mockResolvedValue(own)
  mockMemberCount.mockResolvedValue(memberships)
  mockClientCount.mockResolvedValue(clients)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u_1', role: 'TRAINER' } })
})

describe('POST /api/profile/switch', () => {
  it('sets the cookie for a side the user genuinely holds', async () => {
    access({ own: 1, clients: 1 })
    const res = await post({ side: 'client' })
    expect(res.status).toBe(200)
    expect(res.cookies.get(PROFILE_COOKIE)?.value).toBe('client')
  })

  it('refuses a side the user has no relationship for', async () => {
    access({ own: 1 }) // trainer only
    const res = await post({ side: 'client' })
    expect(res.status).toBe(403)
    expect(res.cookies.get(PROFILE_COOKIE)).toBeUndefined()
  })

  it('lets a CLIENT-role contractor switch to their trainer side', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u_2', role: 'CLIENT' } })
    access({ own: 0, memberships: 1, clients: 1 })
    const res = await post({ side: 'trainer' })
    expect(res.status).toBe(200)
    expect(res.cookies.get(PROFILE_COOKIE)?.value).toBe('trainer')
  })

  it('rejects an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await post({ side: 'trainer' })).status).toBe(401)
  })

  it('rejects an unknown side', async () => {
    access({ own: 1, clients: 1 })
    expect((await post({ side: 'admin' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })

  // The cookie is httpOnly so page JS can't forge it client-side.
  it('sets the cookie httpOnly', async () => {
    access({ own: 1, clients: 1 })
    const res = await post({ side: 'client' })
    expect(res.cookies.get(PROFILE_COOKIE)?.httpOnly).toBe(true)
  })
})
