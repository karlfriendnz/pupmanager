import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { syncInvoiceToXero, syncPaymentToXero } from '@/lib/xero-sync'

// Manually re-run a payment's Xero sync — the recovery path for anything stuck
// in ERROR (e.g. a mapping was fixed after the first attempt). Owner-only +
// same-origin. A PAID payment re-runs the full payment sync (which ensures the
// invoice too); an unpaid one just re-pushes the invoice.
const schema = z.object({ paymentId: z.string().min(1) })

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  // Re-running a Xero sync touches the accounting connection — gate on
  // settings.edit (owner/manager), matching the Xero surface.
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // Ownership: the payment must belong to this trainer.
  const payment = await prisma.payment.findFirst({
    where: { id: parsed.data.paymentId, trainerId: guard.companyId },
    select: { id: true, status: true },
  })
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result =
    payment.status === 'PAID'
      ? await syncPaymentToXero(payment.id)
      : await syncInvoiceToXero(payment.id)

  return NextResponse.json(result)
}
