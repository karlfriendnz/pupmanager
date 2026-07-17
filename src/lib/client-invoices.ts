// The client-side (dog owner) view of their invoices.
//
// Two jobs, deliberately in one place:
//   1. FETCH — scoped to BOTH the signed-in client's own ClientProfile id AND
//      the trainer that profile belongs to. A client can work with several
//      trainers (one ClientProfile per trainer, pinned by the active-trainer
//      cookie — see client-context.ts), so "my invoices" always means "the
//      active trainer's invoices for me". Ids never come from the URL.
//   2. SHAPE — split outstanding vs paid and compute what the client is
//      actually asked to pay. The payable total MUST match the pay page
//      (src/app/pay/[token]/page.tsx), the invoice email (invoicing.ts) and
//      Stripe checkout (connect-checkout.ts): they all derive the card
//      surcharge from estimateProcessingSurcharge(). Quoting a client one
//      number here and charging another at Stripe was a real bug — don't
//      recompute the fee by hand.

import { prisma } from './prisma'
import { getActiveClient } from './client-context'
import { estimateProcessingSurcharge } from './connect'

// formatMoney moved to ./money (pure, client-safe) — this module imports prisma
// + client-context (next/headers), so a 'use client' component importing
// anything from here would pull server-only code into the client bundle and
// fail the build. Re-exported so existing server-side callers stay unchanged;
// client components must import from './money' directly.
export { formatMoney } from './money'

export interface ClientInvoiceRecord {
  id: string
  description: string | null
  amountCents: number
  amountPaidCents: number
  currency: string
  status: string
  sentAt: Date | null
  paidAt: Date | null
  createdAt: Date
  payToken: string | null
  lines: { id: string; description: string; quantity: number; amountCents: number }[]
}

export interface ClientInvoiceView extends ClientInvoiceRecord {
  /** Still owing on the invoice itself (never negative). */
  balanceCents: number
  /** Card processing fee added at checkout when the trainer passes it on. */
  surchargeCents: number
  /** What the card is actually charged: balance + surcharge. */
  payableTotalCents: number
  isPaid: boolean
  /**
   * The invoice's own in-app page (/my-invoices/<token>) — the client's copy of
   * the invoice, paid or not. It renders the same card as the public pay page
   * (line items, totals, surcharge and, when payable, Stripe checkout) but
   * INSIDE the app shell so the left menu stays. Tapping a row just goes there
   * rather than duplicating any of it.
   */
  href: string | null
  /** True when that page can actually take a card (Stripe live on this trainer). */
  canPayOnline: boolean
}

export interface InvoiceShapeOptions {
  /** trainer.acceptPaymentsEnabled && trainer.connectChargesEnabled */
  canTakeCard: boolean
  /** trainer.passProcessingFeeToClient */
  passProcessingFeeToClient: boolean
}

export interface ClientInvoiceSummary {
  outstanding: ClientInvoiceView[]
  paid: ClientInvoiceView[]
  /** Sum of every outstanding invoice's payable total (incl. surcharge). */
  totalOutstandingCents: number
  /** Currency of the outstanding invoices (the trainer's payout currency). */
  currency: string
}

/**
 * Split a client's invoices into outstanding (pay these) and paid (receipts),
 * and work out the exact amount each unpaid one will charge.
 *
 * CANCELLED invoices are dropped entirely — nothing is owed and there's nothing
 * to receipt, so showing them would only worry the client.
 */
export function buildClientInvoiceSummary(
  invoices: ClientInvoiceRecord[],
  opts: InvoiceShapeOptions,
  fallbackCurrency = 'nzd',
): ClientInvoiceSummary {
  const live = invoices.filter(i => i.status !== 'CANCELLED')

  const views: ClientInvoiceView[] = live.map(inv => {
    const balanceCents = Math.max(0, inv.amountCents - inv.amountPaidCents)
    const isPaid = inv.status === 'PAID' || balanceCents <= 0
    // Same rule as the pay page: only an outstanding balance on a card-capable
    // trainer who passes the fee on carries a surcharge.
    const surchargeCents = !isPaid && opts.canTakeCard && opts.passProcessingFeeToClient
      ? estimateProcessingSurcharge(balanceCents, inv.currency)
      : 0
    return {
      ...inv,
      balanceCents,
      surchargeCents,
      payableTotalCents: balanceCents + surchargeCents,
      isPaid,
      // Every invoice — paid or not — links to its own in-app page. Paid ones
      // read as a receipt there; unpaid ones can be paid there.
      href: inv.payToken ? `/my-invoices/${inv.payToken}` : null,
      canPayOnline: !isPaid && !!inv.payToken && opts.canTakeCard,
    }
  })

  const outstanding = views
    .filter(v => !v.isPaid)
    // Oldest first — the one that's been waiting longest is the one to pay.
    .sort((a, b) => (a.sentAt ?? a.createdAt).getTime() - (b.sentAt ?? b.createdAt).getTime())
  const paid = views
    .filter(v => v.isPaid)
    // Newest first — a receipt list reads most-recent-down.
    .sort((a, b) => (b.paidAt ?? b.createdAt).getTime() - (a.paidAt ?? a.createdAt).getTime())

  return {
    outstanding,
    paid,
    totalOutstandingCents: outstanding.reduce((sum, v) => sum + v.payableTotalCents, 0),
    currency: outstanding[0]?.currency ?? paid[0]?.currency ?? fallbackCurrency,
  }
}

export interface ClientInvoicesPageData {
  businessName: string | null
  summary: ClientInvoiceSummary
}

/**
 * Every invoice the ACTIVE trainer has raised against the signed-in client.
 *
 * Security: the where-clause is `{ clientId: <active profile>, trainerId:
 * <that profile's trainer> }`. Both come from the session + active-trainer
 * cookie (validated in getActiveClient against the user's own profiles) — never
 * from a request parameter. So a client can't see another client's invoice, and
 * can't see an invoice from a trainer they aren't currently viewing.
 *
 * Returns null when there's no active client (caller redirects to /login).
 */
export async function getActiveClientInvoices(): Promise<ClientInvoicesPageData | null> {
  const active = await getActiveClient()
  if (!active) return null

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true,
      trainerId: true,
      trainer: {
        select: {
          businessName: true,
          acceptPaymentsEnabled: true,
          connectChargesEnabled: true,
          passProcessingFeeToClient: true,
          payoutCurrency: true,
        },
      },
    },
  })
  if (!profile) return null

  const invoices = await prisma.invoice.findMany({
    // Both halves of the guard. clientId alone would already be tenant-safe
    // (a ClientProfile belongs to exactly one trainer), but pinning trainerId
    // too means a future schema change can't silently widen this query.
    where: { clientId: profile.id, trainerId: profile.trainerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, description: true, amountCents: true, amountPaidCents: true,
      currency: true, status: true, sentAt: true, paidAt: true, createdAt: true,
      payToken: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, description: true, quantity: true, amountCents: true },
      },
    },
  })

  const canTakeCard = !!(profile.trainer.acceptPaymentsEnabled && profile.trainer.connectChargesEnabled)
  const summary = buildClientInvoiceSummary(
    invoices,
    { canTakeCard, passProcessingFeeToClient: !!profile.trainer.passProcessingFeeToClient },
    profile.trainer.payoutCurrency ?? 'nzd',
  )

  return { businessName: profile.trainer.businessName, summary }
}
