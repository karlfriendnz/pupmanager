import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Paginated, searchable list of client→trainer transactions (money that moved).
// Guarded by billing.view; scoped to the caller's company. Search matches the
// description or the client's name.
const PAGE_SIZE = 20
const TX_STATUSES: Prisma.PaymentWhereInput['status'] = { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'] }

export async function GET(req: Request) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)

  const where: Prisma.PaymentWhereInput = {
    trainerId: ctx.companyId,
    status: TX_STATUSES,
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { client: { is: { user: { is: { name: { contains: q, mode: 'insensitive' } } } } } },
          ],
        }
      : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, description: true, amountTotal: true, currency: true,
        applicationFeeAmount: true, stripeFeeAmount: true, amountRefunded: true,
        status: true, paidAt: true, createdAt: true,
        client: { select: { user: { select: { name: true } } } },
      },
    }),
  ])

  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    items: rows.map(r => ({
      id: r.id,
      description: r.description,
      clientName: r.client?.user?.name ?? null,
      amountTotal: r.amountTotal,
      currency: r.currency,
      applicationFeeAmount: r.applicationFeeAmount,
      stripeFeeAmount: r.stripeFeeAmount,
      amountRefunded: r.amountRefunded,
      status: r.status,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}
