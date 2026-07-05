import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { resyncReceivableToXero } from '@/lib/invoicing'

// Full detail for a single receivable — the data behind the printable invoice
// document. Company-scoped + billing.view-guarded, mirroring the list route.
// Returns the richer set the list omits: client email/address + the business
// header (name, logo, contact email, postal address).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    // Scope by trainerId so one company can't read another's invoice by id.
    where: { id, trainerId: ctx.companyId },
    select: {
      id: true, description: true, amountCents: true, amountPaidCents: true, currency: true,
      status: true, sentAt: true, paidAt: true, createdAt: true, payToken: true,
      xeroInvoiceId: true, xeroSyncStatus: true, xeroSyncError: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, description: true, quantity: true, unitAmountCents: true, amountCents: true },
      },
      client: {
        select: {
          addressLine: true, phone: true,
          user: { select: { name: true, email: true } },
        },
      },
      trainer: {
        select: {
          businessName: true, logoUrl: true, publicEmail: true,
          addressLine1: true, addressLine2: true, addressCity: true,
          addressRegion: true, addressPostcode: true, addressCountry: true,
        },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const b = invoice.trainer
  const businessAddress = [
    b.addressLine1, b.addressLine2, b.addressCity, b.addressRegion, b.addressPostcode, b.addressCountry,
  ].filter(Boolean).join(', ')

  return NextResponse.json({
    id: invoice.id,
    // Short human reference — the tail of the cuid, upper-cased.
    reference: `INV-${invoice.id.slice(-6).toUpperCase()}`,
    description: invoice.description,
    amountCents: invoice.amountCents,
    amountPaidCents: invoice.amountPaidCents,
    currency: invoice.currency,
    status: invoice.status,
    createdAt: invoice.createdAt.toISOString(),
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    payToken: invoice.payToken,
    xeroInvoiceId: invoice.xeroInvoiceId,
    xeroSyncStatus: invoice.xeroSyncStatus,
    xeroSyncError: invoice.xeroSyncError,
    lines: invoice.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      unitAmountCents: l.unitAmountCents,
      amountCents: l.amountCents,
    })),
    client: {
      name: invoice.client?.user?.name ?? null,
      email: invoice.client?.user?.email ?? null,
      address: invoice.client?.addressLine ?? null,
      phone: invoice.client?.phone ?? null,
    },
    business: {
      name: b.businessName ?? null,
      logoUrl: b.logoUrl ?? null,
      email: b.publicEmail ?? null,
      address: businessAddress || null,
    },
  })
}

// Edit a receivable's line items — replace-all semantics: the posted `lines`
// array becomes the invoice's complete set of lines, and Invoice.amountCents +
// description are recomputed from it. Only UNPAID invoices are editable; a PAID
// or CANCELLED invoice is locked (409). When the invoice is mirrored in Xero the
// edit is re-pushed to update it in place (best-effort).
const patchSchema = z.object({
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(1000),
        unitAmountCents: z.number().int().min(0).max(10_000_000),
        xeroAccountCode: z.string().max(50).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const invoice = await prisma.invoice.findFirst({
    where: { id, trainerId: ctx.companyId },
    select: { id: true, status: true, xeroInvoiceId: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Lock editing once anything has been paid (PARTIAL or PAID) or it's cancelled.
  if (invoice.status !== 'UNPAID') {
    const reason =
      invoice.status === 'PARTIAL' ? 'This invoice has already been partly paid and can no longer be edited.'
      : invoice.status === 'PAID' ? 'This invoice has been paid and can no longer be edited.'
      : 'This invoice is locked and can no longer be edited.'
    return NextResponse.json({ error: reason }, { status: 409 })
  }

  // Recompute each line's total + the invoice total.
  const lines = parsed.data.lines.map((l, i) => ({
    description: l.description,
    quantity: l.quantity,
    unitAmountCents: l.unitAmountCents,
    amountCents: l.quantity * l.unitAmountCents,
    xeroAccountCode: l.xeroAccountCode ?? null,
    sortOrder: i,
  }))
  const total = lines.reduce((sum, l) => sum + l.amountCents, 0)

  // Replace-all in one transaction: drop the old lines, write the new set, and
  // refresh the cached total + description (first line as the label).
  await prisma.$transaction([
    prisma.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } }),
    prisma.invoiceLineItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: invoice.id })) }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountCents: total, description: lines[0].description },
    }),
  ])

  // Re-push the edit to Xero when the invoice is already mirrored there.
  // Best-effort — records its own SYNCED/ERROR status and never blocks the save.
  if (invoice.xeroInvoiceId) {
    await resyncReceivableToXero(invoice.id).catch((e) => console.error('[receivable] xero re-sync failed', invoice.id, e))
  }

  return NextResponse.json({ ok: true })
}
