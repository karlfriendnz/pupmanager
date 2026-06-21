import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { requireSameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { sendInvoiceNotification } from '@/lib/invoice'

// Re-send the pay-link notification + email for an existing UNPAID invoice.
// Scoped to the caller's company; only PENDING invoices can be resent.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params
  const limited = await enforceRateLimit({ key: `invoice-resend:${ctx.companyId}`, limit: 30, windowMs: 10 * 60_000 })
  if (limited) return limited

  const payment = await prisma.payment.findFirst({
    where: { id, trainerId: ctx.companyId, items: { some: { intent: { path: ['invoice'], equals: true } } } },
    select: {
      id: true, status: true, amountTotal: true, currency: true, description: true,
      client: { select: { userId: true, user: { select: { email: true } } } },
      trainer: { select: { businessName: true } },
    },
  })
  if (!payment) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (payment.status !== 'PENDING') {
    return NextResponse.json({ error: 'That invoice is already settled.' }, { status: 409 })
  }

  await sendInvoiceNotification({
    paymentId: payment.id,
    clientUserId: payment.client?.userId ?? null,
    clientEmail: payment.client?.user?.email ?? null,
    businessName: payment.trainer.businessName ?? 'Your trainer',
    description: payment.description ?? 'Payment',
    amount: payment.amountTotal,
    currency: payment.currency,
  })

  return NextResponse.json({ ok: true })
}
