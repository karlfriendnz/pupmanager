import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

// Inbound Xero webhook. Verifies x-xero-signature = base64(HMAC-SHA256(rawBody,
// XERO_WEBHOOK_KEY)); drives the Intent-To-Receive handshake; reconciles the
// matching local invoice on valid INVOICE events.
const KEY = 'test-webhook-key'
const h = vi.hoisted(() => ({ invoiceFindMany: vi.fn(), reconcile: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findMany: h.invoiceFindMany } } }))
vi.mock('@/lib/invoicing', () => ({ reconcileXeroPayment: h.reconcile }))
vi.mock('@/lib/env', () => ({ env: { XERO_WEBHOOK_KEY: 'test-webhook-key' } }))

import { POST } from '@/app/api/xero/webhook/route'

function sign(body: string, key = KEY) {
  return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64')
}
function req(body: string, sig: string | null) {
  return new Request('http://x/api/xero/webhook', {
    method: 'POST',
    headers: sig ? { 'x-xero-signature': sig } : {},
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.invoiceFindMany.mockResolvedValue([])
  h.reconcile.mockResolvedValue({ ok: true })
})

describe('POST /api/xero/webhook', () => {
  it('401s on a bad signature', async () => {
    const body = JSON.stringify({ events: [] })
    const res = await POST(req(body, 'wrong-signature'))
    expect(res.status).toBe(401)
    expect(h.reconcile).not.toHaveBeenCalled()
  })

  it('401s when the signature header is missing', async () => {
    const res = await POST(req(JSON.stringify({ events: [] }), null))
    expect(res.status).toBe(401)
  })

  it('200s on Intent To Receive (valid signature, empty events)', async () => {
    const body = JSON.stringify({ events: [] })
    const res = await POST(req(body, sign(body)))
    expect(res.status).toBe(200)
    expect(h.reconcile).not.toHaveBeenCalled()
  })

  it('reconciles matching invoices on valid INVOICE events (ignoring other categories)', async () => {
    const body = JSON.stringify({
      events: [
        { eventCategory: 'INVOICE', resourceId: 'XINV-1' },
        { eventCategory: 'INVOICE', resourceId: 'XINV-1' }, // dedup
        { eventCategory: 'CONTACT', resourceId: 'C-9' },
      ],
    })
    h.invoiceFindMany.mockResolvedValue([{ id: 'inv-1' }])
    const res = await POST(req(body, sign(body)))
    expect(res.status).toBe(200)
    expect(h.invoiceFindMany).toHaveBeenCalledWith({ where: { xeroInvoiceId: { in: ['XINV-1'] } }, select: { id: true } })
    expect(h.reconcile).toHaveBeenCalledWith('inv-1')
    expect(h.reconcile).toHaveBeenCalledTimes(1)
  })
})
