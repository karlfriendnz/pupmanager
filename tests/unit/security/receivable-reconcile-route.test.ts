import { describe, it, expect, vi, beforeEach } from 'vitest'

// Manual "Check Xero for payments" — billing.view guarded + company-scoped.
const h = vi.hoisted(() => ({ guard: vi.fn(), reconcileTrainer: vi.fn() }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/invoicing', () => ({ reconcileTrainerXeroPayments: h.reconcileTrainer }))

import { POST } from '@/app/api/trainer/finances/receivables/reconcile/route'
import { NextResponse } from 'next/server'

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't-1', role: 'OWNER', permissions: {} })
  h.reconcileTrainer.mockResolvedValue({ checked: 2, updated: 1 })
})

describe('POST /api/trainer/finances/receivables/reconcile', () => {
  it('returns the guard response when billing.view is denied', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Not allowed' }, { status: 403 }))
    const res = await POST()
    expect(res.status).toBe(403)
    expect(h.reconcileTrainer).not.toHaveBeenCalled()
  })

  it('scopes the reconcile to the caller’s company', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    expect(h.reconcileTrainer).toHaveBeenCalledWith('t-1')
    expect(await res.json()).toMatchObject({ ok: true, checked: 2, updated: 1 })
  })
})
