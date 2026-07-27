import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/auth/trainer-search — the only unauthenticated read of the trainer
// table. It exists so a dog owner with no account can find the business they
// train with, which makes "what does it hand out, and to whom" the entire test.
//
//   • business-facing fields only (name, logo, public handle) — never an email,
//     phone, address, client count or the owning user
//   • 2-character minimum, so it can't be walked as a full directory dump
//   • capped result count + rate limited
//   • deactivated accounts excluded (they can't answer a join request)

const h = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/prisma', () => ({ prisma: { trainerProfile: { findMany: h.findMany } } }))

import { GET } from '@/app/api/auth/trainer-search/route'

const req = (q: string) =>
  new Request(`https://app.pupmanager.com/api/auth/trainer-search?q=${encodeURIComponent(q)}`)

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.enforceRateLimit.mockResolvedValue(null)
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.findMany.mockResolvedValue([
    { id: 't1', businessName: 'Pawsome Dog Training', logoUrl: null, slug: 'pawsome' },
  ])
})

describe('GET /api/auth/trainer-search', () => {
  it('returns only business-facing fields', async () => {
    const res = await GET(req('paw'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      trainers: [{ id: 't1', businessName: 'Pawsome Dog Training', logoUrl: null, slug: 'pawsome' }],
    })

    const select = h.findMany.mock.calls[0][0].select
    expect(Object.keys(select).sort()).toEqual(['businessName', 'id', 'logoUrl', 'slug'])
    // Belt and braces: nothing private can be added by accident.
    for (const leak of ['phone', 'publicEmail', 'user', 'addressLine', 'stripeCustomerId']) {
      expect(select).not.toHaveProperty(leak)
    }
  })

  it('excludes deactivated accounts and caps the result count', async () => {
    await GET(req('paw'))
    const args = h.findMany.mock.calls[0][0]
    expect(args.where.user).toEqual({ deactivatedAt: null })
    expect(args.take).toBeLessThanOrEqual(8)
  })

  it('refuses to answer a one-character query (no directory dump)', async () => {
    const res = await GET(req('a'))
    expect(await res.json()).toEqual({ trainers: [] })
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('refuses an empty query', async () => {
    const res = await GET(new Request('https://app.pupmanager.com/api/auth/trainer-search'))
    expect(await res.json()).toEqual({ trainers: [] })
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('honours the rate limiter', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    const res = await GET(req('paw'))
    expect(res.status).toBe(429)
    expect(h.findMany).not.toHaveBeenCalled()
  })
})
