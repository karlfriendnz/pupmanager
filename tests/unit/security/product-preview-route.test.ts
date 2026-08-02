import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /products/:productId/preview — the trainer's way into "see this the way
// a client does". It hands out a CLIENT PREVIEW COOKIE, so the checks it makes
// before doing that are the whole security surface: the caller must be a
// trainer, the product must be theirs, and the client it previews as must be
// theirs too.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieGet: vi.fn(),
  productFindFirst: vi.fn(),
  clientFindFirst: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: h.cookieGet }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: h.productFindFirst },
    clientProfile: { findFirst: h.clientFindFirst },
  },
}))

import { GET } from '@/app/(trainer)/products/[productId]/preview/route'
import { PREVIEW_COOKIE } from '@/lib/client-context'

const TRAINER = { user: { id: 'u_karl', role: 'TRAINER', trainerId: 'trainer_A' } }

function call(productId = 'p1') {
  return GET(new Request('http://localhost/products/p1/preview'), {
    params: Promise.resolve({ productId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue(TRAINER)
  h.cookieGet.mockReturnValue(undefined)
  h.productFindFirst.mockResolvedValue({ id: 'p1' })
  h.clientFindFirst.mockResolvedValue({ id: 'cp_sarah' })
})

describe('who may preview', () => {
  it('turns away anyone who isn’t signed in', async () => {
    h.auth.mockResolvedValue(null)
    const res = await call()
    expect(res.headers.get('location')).toBe('http://localhost/login')
    expect(h.productFindFirst).not.toHaveBeenCalled()
  })

  it('turns away a CLIENT — this hands out a trainer-only cookie', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_owner', role: 'CLIENT' } })
    const res = await call()
    expect(res.headers.get('location')).toBe('http://localhost/login')
    expect(res.cookies.get(PREVIEW_COOKIE)).toBeUndefined()
  })

  it('looks the product up scoped to the caller’s own business', async () => {
    await call('p1')
    expect(h.productFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', trainerId: 'trainer_A' } }),
    )
  })

  it('bounces on another trainer’s product without setting anything', async () => {
    h.productFindFirst.mockResolvedValue(null)
    const res = await call('p_theirs')
    expect(res.headers.get('location')).toBe('http://localhost/products')
    expect(res.cookies.get(PREVIEW_COOKIE)).toBeUndefined()
    // And it never went looking for a client to preview as.
    expect(h.clientFindFirst).not.toHaveBeenCalled()
  })
})

describe('which client it previews as', () => {
  it('lands on the shop with the product open, cookie set', async () => {
    const res = await call('p1')
    expect(res.headers.get('location')).toBe('http://localhost/my-shop?product=p1')
    expect(res.cookies.get(PREVIEW_COOKIE)?.value).toBe('cp_sarah')
    // httpOnly, so nothing on the page can read or forge the preview identity.
    expect(res.cookies.get(PREVIEW_COOKIE)?.httpOnly).toBe(true)
  })

  it('picks an ACTIVE client of THIS trainer', async () => {
    await call()
    expect(h.clientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'trainer_A', status: 'ACTIVE' } }),
    )
  })

  it('keeps the client already being previewed, re-checked against this trainer', async () => {
    h.cookieGet.mockReturnValue({ value: 'cp_mid_preview' })
    h.clientFindFirst.mockResolvedValue({ id: 'cp_mid_preview' })
    const res = await call()
    expect(h.clientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cp_mid_preview', trainerId: 'trainer_A' } }),
    )
    expect(res.cookies.get(PREVIEW_COOKIE)?.value).toBe('cp_mid_preview')
  })

  it('ignores a cookie naming somebody else’s client and picks its own', async () => {
    h.cookieGet.mockReturnValue({ value: 'cp_of_trainer_B' })
    // First lookup (the stale cookie, scoped to trainer_A) misses; the fallback
    // finds a real one.
    h.clientFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cp_sarah' })
    const res = await call()
    expect(res.cookies.get(PREVIEW_COOKIE)?.value).toBe('cp_sarah')
  })

  it('sends a trainer with no clients to the demo rather than a blank shop', async () => {
    h.clientFindFirst.mockResolvedValue(null)
    const res = await call()
    expect(res.headers.get('location')).toBe('http://localhost/preview-as')
    expect(res.cookies.get(PREVIEW_COOKIE)).toBeUndefined()
  })
})
