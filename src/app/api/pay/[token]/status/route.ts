import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PUBLIC, token-gated status probe for the pay page's auto-confirm poll. Returns
// only the invoice's status + amounts (no PII) so a client returning from Stripe
// can watch the async webhook settle the invoice. Cheap: one indexed lookup.
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 8) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invoice = await prisma.invoice.findUnique({
    where: { payToken: token },
    select: { status: true, amountCents: true, amountPaidCents: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: invoice.status,
    amountCents: invoice.amountCents,
    amountPaidCents: invoice.amountPaidCents,
  })
}
