import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/finances/receivables/[id]/send — mark an unsent receivable
// as sent + notify the client. billing.view-guarded; company-scoped via
// sendReceivable(id, ctx.companyId).
const h = vi.hoisted(() => ({ guard: vi.fn(), sendReceivable: vi.fn() }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/invoicing', () => ({ sendReceivable: h.sendReceivable }))

import { POST } from '@/app/api/trainer/finances/receivables/[id]/send/route'
import { NextResponse } from 'next/server'

const params = { params: Promise.resolve({ id: 'inv-1' }) }
function post() {
  return POST(new Request('http://x/api/trainer/finances/receivables/inv-1/send', { method: 'POST' }), params)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't-1', role: 'OWNER', permissions: {} })
  h.sendReceivable.mockResolvedValue(true)
})

describe('POST receivables/[id]/send', () => {
  it('returns the guard response when billing.view is denied', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.sendReceivable).not.toHaveBeenCalled()
  })

  it('scopes the send to the caller’s company', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.sendReceivable).toHaveBeenCalledWith('inv-1', 't-1')
  })

  it('404s when the invoice cannot be sent (not found / cancelled / cross-tenant)', async () => {
    h.sendReceivable.mockResolvedValue(false)
    const res = await post()
    expect(res.status).toBe(404)
  })
})
