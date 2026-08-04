import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { createManualSaleInvoice } from '@/lib/invoicing'
import { fulfilInPersonSale, resolveSaleItems } from '@/lib/in-person-sale'

// Paginated, searchable list of the trainer's receivables — the new
// payment-method-agnostic `Invoice` rows (bank transfer / Xero, no Stripe
// required). Separate from /finances/invoices, which lists Stripe pay-link
// Payments. Guarded by billing.view, scoped to the company.
const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export async function GET(req: Request) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  // Optional larger page (the client-profile view pulls a whole client's history
  // in one request); capped so it can't be abused.
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))
  // Optional filter to a single client (their profile's Invoices tab / Overview).
  const clientId = url.searchParams.get('clientId')?.trim() || null
  // Optional status filter: all | unsent | sent | paid.
  const status = url.searchParams.get('status') ?? 'all'
  const statusFilter: Prisma.InvoiceWhereInput =
    status === 'unsent' ? { sentAt: null, status: { not: 'CANCELLED' } }
    : status === 'sent' ? { sentAt: { not: null }, status: 'UNPAID' }
    : status === 'paid' ? { status: 'PAID' }
    : {}

  const where: Prisma.InvoiceWhereInput = {
    trainerId: ctx.companyId,
    ...(clientId ? { clientId } : {}),
    ...statusFilter,
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { client: { is: { user: { is: { name: { contains: q, mode: 'insensitive' } } } } } },
          ],
        }
      : {}),
  }

  const [total, rows, xeroConn] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, description: true, amountCents: true, amountPaidCents: true, currency: true,
        status: true, sentAt: true, paidAt: true, createdAt: true,
        xeroInvoiceId: true, xeroSyncStatus: true, xeroSyncError: true,
        client: { select: { user: { select: { name: true } } } },
      },
    }),
    prisma.xeroConnection.findUnique({ where: { trainerId: ctx.companyId }, select: { id: true } }),
  ])

  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    xeroConnected: !!xeroConn,
    items: rows.map(r => ({
      id: r.id,
      description: r.description,
      clientName: r.client?.user?.name ?? null,
      amountCents: r.amountCents,
      amountPaidCents: r.amountPaidCents,
      currency: r.currency,
      status: r.status,
      sentAt: r.sentAt?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      xeroInvoiceId: r.xeroInvoiceId,
      xeroSyncStatus: r.xeroSyncStatus,
      xeroSyncError: r.xeroSyncError,
    })),
  })
}

// Ring up an ad-hoc in-person sale — the "instant sale" (POS) flow. Creates an
// UNPAID receivable with arbitrary line items for a client, and hands back the
// payToken so the caller can render /pay/<token> as a QR code for the client to
// pay on their own phone. Every other Invoice creation path spawns automatically
// off an assignment; this is the only one a trainer drives directly.
//
// A line rung up off the catalogue also names its PRODUCT (and its VARIANT, if
// the trainer picked a size), which is what makes it a sale rather than a
// sentence: see src/lib/in-person-sale.ts for the shelf and the hand-over it
// writes. A one-off "Something else" line carries neither, and is money only.
//
// Line validation mirrors the line-editing PATCH on [id]/route.ts — same bounds,
// so a sale can't create something the editor would then reject.
const postSchema = z.object({
  clientId: z.string().min(1),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(1000),
        unitAmountCents: z.number().int().min(0).max(10_000_000),
        xeroAccountCode: z.string().max(50).nullable().optional(),
        // Both optional and both nullable: an older composer (a phone that
        // hasn't reloaded) sends neither, and its sale still goes through as
        // free text rather than 400ing at the till.
        productId: z.string().min(1).nullable().optional(),
        variantId: z.string().min(1).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
  // Generated by the composer, one per sale. Makes a double-tap idempotent.
  idempotencyKey: z.string().min(8).max(64),
})

export async function POST(req: Request) {
  const ctx = await guardPermission('billing.manage')
  if (ctx instanceof NextResponse) return ctx

  // Opt-in add-on: off until the trainer enables it in Settings → Add-ons.
  if (!(await hasAddon(ctx.companyId, 'pos'))) {
    return NextResponse.json({ error: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  // BEFORE any money: every catalogue line has to be this trainer's product,
  // with an option that belongs to it and enough on the shelf. Refusing here
  // means the trainer hears "only 2 Larges left" with the client still in front
  // of them, instead of an invoice landing against a shelf that can't fill it.
  const resolved = await resolveSaleItems(
    ctx.companyId,
    parsed.data.lines.flatMap(l =>
      l.productId ? [{ productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity }] : [],
    ),
  )
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 409 })

  try {
    const invoice = await createManualSaleInvoice({
      trainerId: ctx.companyId,
      clientId: parsed.data.clientId,
      lines: parsed.data.lines,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    // Only a NEW sale moves stock. A repeat of the same idempotency key is the
    // same sale — a double-tap, or a retry on a flaky connection — and the
    // units already came off the shelf the first time round.
    if (invoice.created && resolved.items.length > 0) {
      await prisma.$transaction(tx =>
        fulfilInPersonSale(tx, {
          trainerId: ctx.companyId,
          clientId: parsed.data.clientId,
          userId: ctx.userId,
          items: resolved.items,
        }),
      )
    }
    return NextResponse.json({
      id: invoice.id,
      payToken: invoice.payToken,
      amountCents: invoice.amountCents,
    })
  } catch (err) {
    // createManualSaleInvoice throws rather than swallowing — a trainer standing
    // in front of a client must never be told a sale worked when it didn't.
    console.error('[receivables] manual sale failed', err)
    return NextResponse.json({ error: 'Could not create the sale' }, { status: 500 })
  }
}
