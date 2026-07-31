import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/profile/choose — the form behind the one-time "which account?"
// screen. It writes the pm-profile cookie, which decides which surface the
// middleware routes you to, so it must never write a side the person cannot
// actually reach.
//
// The cookie is only ever a routing HINT — the (trainer)/(client) layouts
// re-derive real access from the database on every request — but a wrong hint
// still means a confusing bounce, and a route that trusts a form field is one
// refactor away from being the boundary.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  canUseProfile: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/account-access', async (orig) => ({
  ...(await orig() as object),
  canUseProfile: h.canUseProfile,
}))

import { POST } from '@/app/api/profile/choose/route'

function submit(side: string | null) {
  const body = new FormData()
  if (side !== null) body.set('side', side)
  return POST(new Request('http://localhost/api/profile/choose', { method: 'POST', body }))
}

const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? ''

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user_1' } })
  h.canUseProfile.mockResolvedValue(true)
})

describe('choosing a side', () => {
  it('sets the cookie and sends them to the side they picked', async () => {
    const res = await submit('client')
    expect(res.headers.get('location')).toContain('/home')
    expect(cookieOf(res)).toContain('pm-profile=client')
  })

  it('sends a trainer choice to the dashboard', async () => {
    const res = await submit('trainer')
    expect(res.headers.get('location')).toContain('/dashboard')
    expect(cookieOf(res)).toContain('pm-profile=trainer')
  })

  it('refuses a side the person cannot reach, and writes NO cookie', async () => {
    // The assertion that matters: a hand-posted form must not be able to pin
    // someone to a surface they have no rows for.
    h.canUseProfile.mockResolvedValue(false)

    const res = await submit('trainer')

    expect(res.headers.get('location')).toContain('/choose-account')
    expect(cookieOf(res)).not.toContain('pm-profile=trainer')
  })

  it('ignores a junk side', async () => {
    const res = await submit('admin')
    expect(res.headers.get('location')).toContain('/choose-account')
    expect(cookieOf(res)).not.toContain('pm-profile=')
  })

  it('sends a signed-out visitor to login', async () => {
    h.auth.mockResolvedValue(null)
    const res = await submit('client')
    expect(res.headers.get('location')).toContain('/login')
    expect(cookieOf(res)).not.toContain('pm-profile=')
  })

  it('marks the cookie httpOnly so script cannot rewrite the routing hint', async () => {
    const res = await submit('client')
    expect(cookieOf(res).toLowerCase()).toContain('httponly')
  })
})
