import { describe, it, expect, vi, beforeEach } from 'vitest'

// PATCH /api/user persists a trainer's personal landing-page preference
// (dashboard | schedule), honoured by the root redirect in app/page.tsx.
const h = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn() }))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { update: h.update } } }))

import { PATCH } from '@/app/api/user/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/user', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  h.auth.mockReset()
  h.update.mockReset()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.update.mockResolvedValue({ id: 'u1', landingPage: 'schedule' })
})

describe('PATCH /api/user — landing page', () => {
  it('rejects an unauthenticated request', async () => {
    h.auth.mockResolvedValue(null)
    expect((await PATCH(req({ landingPage: 'schedule' }))).status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('saves a valid landing page for the current user', async () => {
    const res = await PATCH(req({ landingPage: 'schedule' }))
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u1' }, data: { landingPage: 'schedule' } })
  })

  it('accepts "dashboard" too', async () => {
    await PATCH(req({ landingPage: 'dashboard' }))
    expect(h.update.mock.calls[0][0].data).toMatchObject({ landingPage: 'dashboard' })
  })

  it('rejects an unknown landing page and writes nothing', async () => {
    const res = await PATCH(req({ landingPage: 'reports' }))
    expect(res.status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })
})
