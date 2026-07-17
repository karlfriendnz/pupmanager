import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { notifyClient } from '@/lib/client-notify'
import { formatMoney } from '@/lib/money'

// "Nudge them to pay this now."
//
// Fires while the trainer is standing in front of the client: the client's own
// phone buzzes and the push taps straight through to that invoice's pay screen
// (/my-invoices/<payToken>), so they never have to scan the trainer's QR or
// hunt through their email. The QR stays as the fallback for a client who
// doesn't have the app or push turned off.
//
// Deliberately separate from the PATCH line-editor next door: that endpoint is
// shared with Finances and shouldn't grow a "…and also message them" side
// effect. Being its own route also means Finances can reuse it later as a
// plain "chase this invoice" action.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    // Company-scoped, like every other receivables route — an id alone must
    // never let one trainer message another's client.
    where: { id, trainerId: ctx.companyId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      amountPaidCents: true,
      currency: true,
      description: true,
      payToken: true,
      client: { select: { userId: true } },
      trainer: { select: { businessName: true } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Nothing to ask for. PAID/CANCELLED are obvious; PARTIAL still owes a
  // balance, so it's fair game.
  if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Nothing left to pay on this invoice.' }, { status: 409 })
  }
  // No token = no pay screen to send them to.
  if (!invoice.payToken) return NextResponse.json({ error: 'This invoice has no pay link.' }, { status: 409 })
  // A guest sale has no client — there's nobody to notify.
  if (!invoice.client?.userId) return NextResponse.json({ error: 'This sale has no client to notify.' }, { status: 409 })

  const owing = Math.max(0, invoice.amountCents - invoice.amountPaidCents)

  // notifyClient is best-effort by contract (it swallows + logs), so this can't
  // fail the sale that triggered it — the trainer already has the QR either way.
  await notifyClient({
    userId: invoice.client.userId,
    trainerId: ctx.companyId,
    type: 'CLIENT_PAYMENT_REQUEST',
    vars: {
      trainerName: invoice.trainer?.businessName ?? 'Your trainer',
      amount: formatMoney(owing, invoice.currency),
      description: invoice.description ?? 'your booking',
    },
    // The tap target — the in-app pay screen for this exact invoice.
    link: `/my-invoices/${invoice.payToken}`,
    ctaLabel: 'Pay now',
  })

  return NextResponse.json({ ok: true })
}
