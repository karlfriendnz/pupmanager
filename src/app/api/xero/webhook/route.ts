import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { reconcileXeroPayment } from '@/lib/invoicing'

// Inbound Xero webhook. Xero signs every delivery with
//   x-xero-signature = base64( HMAC-SHA256(rawBody, XERO_WEBHOOK_KEY) )
// We verify that first (mismatch → 401). This also drives Xero's "Intent To
// Receive" handshake: Xero posts once with the WRONG key (expects 401) and once
// with the RIGHT key (expects 200), so a correct signature check passes ITR for
// free. On valid INVOICE events we reconcile the matching local invoice's
// payment state; we always return 200 quickly so Xero doesn't retry.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

interface XeroEvent {
  resourceId?: string
  eventCategory?: string
  eventType?: string
}

export async function POST(req: Request) {
  const raw = await req.text()
  const signature = req.headers.get('x-xero-signature')
  const key = env.XERO_WEBHOOK_KEY

  // No key configured → we can't trust anything. Reject rather than process.
  if (!key) return new NextResponse('Unauthorised', { status: 401 })

  const expected = crypto.createHmac('sha256', key).update(raw, 'utf8').digest('base64')
  if (!signature || !safeEqual(signature, expected)) {
    return new NextResponse('Unauthorised', { status: 401 })
  }

  // Signature valid. Parse events; an empty/validation ("Intent To Receive")
  // payload simply yields no events and returns 200.
  let payload: { events?: XeroEvent[] } = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = {}
  }
  const events = payload.events ?? []

  // Unique Xero InvoiceIDs from INVOICE events.
  const resourceIds = [
    ...new Set(
      events
        .filter((e) => e.eventCategory === 'INVOICE' && e.resourceId)
        .map((e) => e.resourceId as string),
    ),
  ]

  if (resourceIds.length) {
    // Map each Xero InvoiceID → our invoice and reconcile. Best-effort; a single
    // failure never fails the webhook (Xero would just keep retrying).
    const invoices = await prisma.invoice.findMany({
      where: { xeroInvoiceId: { in: resourceIds } },
      select: { id: true },
    })
    for (const inv of invoices) {
      await reconcileXeroPayment(inv.id).catch((e) => console.error('[xero-webhook] reconcile failed', inv.id, e))
    }
  }

  return NextResponse.json({ ok: true })
}
