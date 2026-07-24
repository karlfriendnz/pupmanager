import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/cron/addon-grant-expiry — warns trainers 2 days before a comped
// add-on trial lapses. Bearer CRON_SECRET guarded; emails once per expiry
// (stamps expiryReminderSentAt); one bad send never stops the batch.
const h = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn(), sendEmail: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerAddon: { findMany: h.findMany, update: h.update } },
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))

import { GET } from '@/app/api/cron/addon-grant-expiry/route'

const SECRET = 'cron-secret-abcdef123456'
const authed = () =>
  new Request('http://x/api/cron/addon-grant-expiry', { headers: { authorization: `Bearer ${SECRET}` } })

const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  itemId: 'shop',
  expiresAt: new Date(Date.now() + 36 * 60 * 60 * 1000), // ~1.5 days out
  trainer: { businessName: 'Waggy Tails', user: { email: 'trainer@example.com', name: 'Sam Doe' } },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  h.update.mockResolvedValue({})
  h.sendEmail.mockResolvedValue({})
})

describe('auth', () => {
  it('401s without the correct Bearer', async () => {
    const res = await GET(new Request('http://x/api/cron/addon-grant-expiry'))
    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })
})

describe('sending', () => {
  it('emails each due grant and stamps expiryReminderSentAt', async () => {
    h.findMany.mockResolvedValue([grant()])
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scanned: 1, sent: 1 })
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'trainer@example.com' })
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g1' },
      data: expect.objectContaining({ expiryReminderSentAt: expect.any(Date) }),
    }))
  })

  it('only queries active admin comps in the final 2 days, unwarned', async () => {
    h.findMany.mockResolvedValue([])
    await GET(authed())
    const where = h.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ grantedByAdmin: true, active: true, expiryReminderSentAt: null })
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
    expect(where.expiresAt.lte).toBeInstanceOf(Date)
    expect(where.trainer).toMatchObject({ isInternal: false })
  })

  it('skips a grant with no email and does not stamp it', async () => {
    h.findMany.mockResolvedValue([grant({ trainer: { businessName: 'X', user: { email: null, name: null } } })])
    const res = await GET(authed())
    expect(await res.json()).toMatchObject({ scanned: 1, sent: 0 })
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('a failed send does not stop the batch nor stamp that grant', async () => {
    h.findMany.mockResolvedValue([grant({ id: 'bad' }), grant({ id: 'ok' })])
    h.sendEmail.mockRejectedValueOnce(new Error('resend down'))
    const res = await GET(authed())
    expect(await res.json()).toMatchObject({ scanned: 2, sent: 1 })
    // Only the successful one is stamped.
    const stamped = h.update.mock.calls.map(c => c[0].where.id)
    expect(stamped).toEqual(['ok'])
  })
})
