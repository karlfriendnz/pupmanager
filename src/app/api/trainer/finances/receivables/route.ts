import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

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
