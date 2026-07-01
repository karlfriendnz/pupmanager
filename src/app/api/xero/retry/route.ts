import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
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

  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // Ownership: the payment must belong to this trainer.
  const payment = await prisma.payment.findFirst({
    where: { id: parsed.data.paymentId, trainerId: session.user.trainerId },
    select: { id: true, status: true },
  })
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result =
    payment.status === 'PAID'
      ? await syncPaymentToXero(payment.id)
      : await syncInvoiceToXero(payment.id)

  return NextResponse.json(result)
}
