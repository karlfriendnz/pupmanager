import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/pay/[token]/status — the public, token-gated status probe the pay
// page polls to auto-confirm. Returns only status/amounts (no PII); scoped to
// the exact payToken; 404 for unknown/short tokens.
const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findUnique: h.findUnique } } }))

import { GET } from '@/app/api/pay/[token]/status/route'

const req = () => new Request('http://x/api/pay/tok/status')
function params(token: string) {
  return { params: Promise.resolve({ token }) }
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/pay/[token]/status', () => {
  it('returns status + amounts for a valid token', async () => {
    h.findUnique.mockResolvedValue({ status: 'PAID', amountCents: 38000, amountPaidCents: 38000 })
    const res = await GET(req(), params('tok-abcdefgh'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'PAID', amountCents: 38000, amountPaidCents: 38000 })
  })

  it('404s an unknown token (no leak)', async () => {
    h.findUnique.mockResolvedValue(null)
    expect((await GET(req(), params('tok-unknownx'))).status).toBe(404)
  })

  it('404s a too-short token without a DB lookup', async () => {
    const res = await GET(req(), params('short'))
    expect(res.status).toBe(404)
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('scopes the lookup to the exact token and selects only status/amounts (no PII)', async () => {
    h.findUnique.mockResolvedValue({ status: 'UNPAID', amountCents: 5000, amountPaidCents: 0 })
    await GET(req(), params('tok-specific1'))
    expect(h.findUnique.mock.calls[0][0].where).toEqual({ payToken: 'tok-specific1' })
    expect(h.findUnique.mock.calls[0][0].select).toEqual({ status: true, amountCents: true, amountPaidCents: true })
  })
})
