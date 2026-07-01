import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Paginated, searchable list of trainer-issued invoices (the "request payment"
// flow), showing paid vs unpaid. An invoice is a Payment with an item flagged
// intent.invoice = true. Guarded by billing.view; scoped to the company.
const PAGE_SIZE = 20

export async function GET(req: Request) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  // Optional status filter: all | unpaid | paid.
  const status = url.searchParams.get('status') ?? 'all'
  const statusFilter: Prisma.PaymentWhereInput =
    status === 'unpaid' ? { status: 'PENDING' }
    : status === 'paid' ? { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }
    : {}

  const where: Prisma.PaymentWhereInput = {
    trainerId: ctx.companyId,
    items: { some: { intent: { path: ['invoice'], equals: true } } },
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
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, description: true, amountTotal: true, currency: true,
        status: true, paidAt: true, createdAt: true,
        xeroSyncStatus: true, xeroSyncError: true,
        client: { select: { user: { select: { name: true } } } },
      },
    }),
    // Only surface Xero sync state to trainers who've actually connected it.
    prisma.xeroConnection.findUnique({ where: { trainerId: ctx.companyId }, select: { id: true } }),
  ])

  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    xeroConnected: !!xeroConn,
    items: rows.map(r => ({
      id: r.id,
      description: r.description,
      clientName: r.client?.user?.name ?? null,
      amountTotal: r.amountTotal,
      currency: r.currency,
      status: r.status,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      xeroSyncStatus: r.xeroSyncStatus,
      xeroSyncError: r.xeroSyncError,
    })),
  })
}
