import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const schema = z.object({
  invoiceIds: z.array(z.string()).min(2).max(50),
})

/**
 * Combine several unpaid invoices into one, so a client with five outstanding
 * bills pays once instead of five times.
 *
 * The new invoice carries every line from the originals (each prefixed with
 * what it came from, so the client can still see what they're paying for), and
 * the originals are CANCELLED with mergedIntoId pointing at the replacement —
 * traceable rather than silently disappearing.
 *
 * Refuses anything that would lose or double-count money: invoices from
 * different clients or currencies, anything already part-paid or paid, and
 * anything already merged.
 */
export async function POST(req: Request) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Pick at least two invoices.' }, { status: 400 })

  // Tenant-scoped fetch: ids alone must never reach another business's invoices.
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: parsed.data.invoiceIds }, trainerId: ctx.companyId },
    select: {
      id: true, clientId: true, currency: true, status: true, amountCents: true,
      amountPaidCents: true, description: true, mergedIntoId: true,
      lines: { orderBy: { sortOrder: 'asc' }, select: { description: true, quantity: true, unitAmountCents: true, amountCents: true } },
    },
  })

  if (invoices.length !== parsed.data.invoiceIds.length) {
    return NextResponse.json({ error: 'Some of those invoices no longer exist.' }, { status: 404 })
  }
  if (new Set(invoices.map(i => i.clientId)).size > 1) {
    return NextResponse.json({ error: 'Those invoices belong to different clients.' }, { status: 409 })
  }
  if (new Set(invoices.map(i => i.currency)).size > 1) {
    return NextResponse.json({ error: 'Those invoices are in different currencies.' }, { status: 409 })
  }
  const notCombinable = invoices.filter(
    i => i.status !== 'UNPAID' || i.amountPaidCents > 0 || i.mergedIntoId,
  )
  if (notCombinable.length > 0) {
    return NextResponse.json(
      { error: 'Only unpaid invoices with nothing paid against them can be combined.' },
      { status: 409 },
    )
  }

  const first = invoices[0]
  const amountCents = invoices.reduce((sum, i) => sum + i.amountCents, 0)

  const combined = await prisma.$transaction(async tx => {
    const created = await tx.invoice.create({
      data: {
        trainerId: ctx.companyId,
        clientId: first.clientId,
        amountCents,
        currency: first.currency,
        status: 'UNPAID',
        description: `Combined invoice (${invoices.length} invoices)`,
        // Deliberately no sourceType/sourceId: those are the idempotency key
        // for assignment invoices, and reusing one here would make a future
        // assignment think it had already been invoiced.
        sentAt: null,
        lines: {
          create: invoices.flatMap((inv, invIdx) =>
            // An invoice always has ≥1 line, but fall back to its own total if
            // an old one somehow doesn't, so nothing is dropped.
            (inv.lines.length > 0 ? inv.lines : [{
              description: inv.description ?? 'Invoice',
              quantity: 1,
              unitAmountCents: inv.amountCents,
              amountCents: inv.amountCents,
            }]).map((l, lineIdx) => ({
              description: inv.description && inv.lines.length > 0
                ? `${inv.description} — ${l.description}`
                : l.description,
              quantity: l.quantity,
              unitAmountCents: l.unitAmountCents,
              amountCents: l.amountCents,
              sortOrder: invIdx * 100 + lineIdx,
            })),
          ),
        },
      },
      select: { id: true, amountCents: true, payToken: true },
    })

    await tx.invoice.updateMany({
      where: { id: { in: invoices.map(i => i.id) } },
      data: { status: 'CANCELLED', mergedIntoId: created.id },
    })

    return created
  })

  return NextResponse.json({ ok: true, invoiceId: combined.id, amountCents: combined.amountCents })
}
