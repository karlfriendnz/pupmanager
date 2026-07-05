import { describe, it, expect, vi, beforeEach } from 'vitest'

// Poll cron for Xero reconciliation — Bearer CRON_SECRET guarded.
const h = vi.hoisted(() => ({ reconcileAll: vi.fn() }))
vi.mock('@/lib/invoicing', () => ({ reconcileAllXeroPayments: h.reconcileAll }))

import { POST } from '@/app/api/cron/xero-reconcile/route'

const SECRET = 'cron-secret-abcdef123456'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  h.reconcileAll.mockResolvedValue({ checked: 3, updated: 1 })
})

describe('POST /api/cron/xero-reconcile', () => {
  it('401s without the correct Bearer', async () => {
    const res = await POST(new Request('http://x/api/cron/xero-reconcile', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(h.reconcileAll).not.toHaveBeenCalled()
  })

  it('401s with a wrong Bearer', async () => {
    const res = await POST(new Request('http://x/api/cron/xero-reconcile', { method: 'POST', headers: { authorization: 'Bearer nope' } }))
    expect(res.status).toBe(401)
  })

  it('runs with the correct Bearer and returns the summary', async () => {
    const res = await POST(new Request('http://x/api/cron/xero-reconcile', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, checked: 3, updated: 1 })
  })
})
