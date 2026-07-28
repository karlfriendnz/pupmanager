import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Sync my calendar now". Connecting backfills automatically from now on, but
// everyone who connected BEFORE that has a calendar missing every class already
// in the diary — and the only catch-up was a CRON_SECRET-guarded endpoint no
// trainer can reach, whose secret is write-only in Vercel so nobody can read it
// either. This is the button that replaces it.
//
// It writes hundreds of events to a third party on one click, so the guards
// matter as much as the feature.
const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  connFindUnique: vi.fn(),
  hasAddon: vi.fn(),
  rateLimit: vi.fn(),
  backfill: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.ctx }))
vi.mock('@/lib/prisma', () => ({
  prisma: { googleCalendarConnection: { findUnique: h.connFindUnique } },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.rateLimit }))
vi.mock('@/lib/google-calendar-sync', () => ({ backfillSessionsToGoogle: h.backfill }))

import { POST } from '@/app/api/google-calendar/backfill/route'

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.ctx.mockResolvedValue({ membershipId: 'mem_1', companyId: 'tr_1' })
  h.connFindUnique.mockResolvedValue({ id: 'conn_1' })
  h.hasAddon.mockResolvedValue(true)
  h.rateLimit.mockResolvedValue(null)
  h.backfill.mockResolvedValue({ activeCompanies: 1, candidates: 62, synced: 62, remaining: 0 })
})

describe('POST /api/google-calendar/backfill', () => {
  it('rejects a caller who is not a trainer', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(401)
    expect(h.backfill).not.toHaveBeenCalled()
  })

  // The connection hangs off the MEMBERSHIP — you can only sync your own.
  it('refuses when this member has no connection', async () => {
    h.connFindUnique.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(409)
    expect(h.backfill).not.toHaveBeenCalled()
  })

  it('refuses when the add-on is switched off', async () => {
    h.hasAddon.mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(409)
    expect(h.backfill).not.toHaveBeenCalled()
  })

  // One press can write hundreds of events to Google. It is not a button to
  // let anyone lean on.
  it('is rate limited', async () => {
    h.rateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    const res = await POST()
    expect(res.status).toBe(429)
    expect(h.backfill).not.toHaveBeenCalled()
  })

  // Never another company's diary.
  it('only ever syncs the caller’s own company', async () => {
    await POST()
    expect(h.backfill).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'tr_1', execute: true }),
    )
  })

  it('reports what it did', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, synced: 62, remaining: 0 })
  })

  // A big diary needs more than one pass — the caller has to be able to tell.
  it('passes the remaining count back so the trainer knows to press again', async () => {
    h.backfill.mockResolvedValue({ activeCompanies: 1, candidates: 700, synced: 500, remaining: 200 })
    expect(await (await POST()).json()).toMatchObject({ synced: 500, remaining: 200 })
  })

  // Google being down is not a 500 the trainer can do nothing with.
  it('turns a Google failure into something readable', async () => {
    h.backfill.mockRejectedValue(new Error('google exploded'))
    const res = await POST()
    expect(res.status).toBe(502)
    expect(String((await res.json()).error)).toMatch(/try again/i)
  })
})
