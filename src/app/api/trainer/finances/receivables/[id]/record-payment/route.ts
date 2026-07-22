import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { applyPaidAmount } from '@/lib/invoicing'

export const runtime = 'nodejs'

const schema = z.object({
  // Minor units. Omitted = "they paid the lot", which is the common case.
  amountCents: z.number().int().positive().optional(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'OTHER']),
  // Whatever helps them reconcile later — a bank statement line, receipt no.
  reference: z.string().max(200).optional().nullable(),
})

/**
 * Record a payment that arrived OUTSIDE PupManager — most often a bank
 * transfer. Card payments come through Stripe and create a Payment row; there
 * was no way at all to say "this one landed in my bank account", so those
 * invoices sat UNPAID for ever and the trainer's finances lied.
 *
 * Reuses applyPaidAmount so a part-payment lands as PARTIAL with exactly the
 * same rules as the Stripe and Xero paths — one definition of what "paid" is.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const { id } = await params
  // Tenant-scoped: an id alone must never reach another business's invoice.
  const invoice = await prisma.invoice.findFirst({
    where: { id, trainerId: ctx.companyId },
    select: { id: true, amountCents: true, amountPaidCents: true, status: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invoice.status === 'CANCELLED') {
    return NextResponse.json({ error: 'That invoice was cancelled.' }, { status: 409 })
  }

  // Payments accumulate — recording $20 twice on a $50 invoice leaves $10 owing,
  // rather than the second one replacing the first.
  const total = invoice.amountPaidCents + (parsed.data.amountCents ?? (invoice.amountCents - invoice.amountPaidCents))
  const applied = applyPaidAmount(invoice, total)

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      ...applied,
      paymentMethod: parsed.data.method,
      paymentReference: parsed.data.reference?.trim() || null,
    },
    select: { id: true, status: true, amountPaidCents: true, amountCents: true },
  })

  return NextResponse.json({ ok: true, ...updated })
}
