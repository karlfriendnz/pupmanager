import { estimateProcessingSurcharge } from '@/lib/connect'
import { PayButton } from './pay-button'
import { PaymentConfirm } from './payment-confirm'

// The invoice card — business identity, line items, totals and the pay action.
//
// ONE rendering, TWO homes: the public no-login pay page (/pay/<token>, reached
// from the invoice email) wraps this in its grey full-screen Shell; the signed-in
// client's in-app route ((client)/my-invoices/<token>) drops it into the app
// shell so the left menu stays. Both derive the card fee from the SAME
// estimateProcessingSurcharge() the list and Stripe checkout use — quoting one
// number and charging another was a real bug, so there's deliberately no second
// copy of this logic.

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
export function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// The exact invoice shape this card needs — shared so both routes fetch the same
// columns (and no more PII than needed: client name only, never email/phone).
export const invoiceDetailSelect = {
  amountCents: true, amountPaidCents: true, currency: true, status: true,
  payToken: true,
  lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, description: true, quantity: true, unitAmountCents: true, amountCents: true } },
  client: { select: { user: { select: { name: true } } } },
  trainer: {
    select: {
      businessName: true, logoUrl: true, publicEmail: true, website: true, acceptPaymentsEnabled: true, connectChargesEnabled: true,
      passProcessingFeeToClient: true,
    },
  },
} as const

export interface InvoiceDetailData {
  amountCents: number
  amountPaidCents: number
  currency: string
  status: string
  payToken: string | null
  lines: { id: string; description: string; quantity: number; unitAmountCents: number; amountCents: number }[]
  client: { user: { name: string | null } | null } | null
  trainer: {
    businessName: string | null
    logoUrl: string | null
    publicEmail: string | null
    website: string | null
    acceptPaymentsEnabled: boolean
    connectChargesEnabled: boolean
    passProcessingFeeToClient: boolean
  }
}

export function InvoiceDetail({ invoice, paid }: { invoice: InvoiceDetailData; paid?: boolean }) {
  const balance = Math.max(0, invoice.amountCents - invoice.amountPaidCents)
  const isPaid = invoice.status === 'PAID' || balance <= 0
  const payable = !isPaid && (invoice.status === 'UNPAID' || invoice.status === 'PARTIAL')
  const canTakeCard = !!(invoice.trainer.acceptPaymentsEnabled && invoice.trainer.connectChargesEnabled)
  const cur = invoice.currency
  // If the trainer passes the card fee on, the CHECKOUT adds a surcharge line —
  // so show it here too. Otherwise the client agrees to $1.00, lands on Stripe
  // and is asked for $1.04: a price that moved after they committed.
  const surcharge = canTakeCard && invoice.trainer.passProcessingFeeToClient
    ? estimateProcessingSurcharge(balance, cur)
    : 0
  const payableTotal = balance + surcharge
  const businessName = invoice.trainer.businessName ?? 'Your trainer'

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
      <div className="h-1.5 bg-accent" />
      <div className="p-6 sm:p-8">
        {/* Business identity */}
        <div className="flex items-center gap-3">
          {invoice.trainer.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.trainer.logoUrl} alt="" className="h-10 w-auto object-contain" />
          )}
          <div>
            <p className="text-base font-bold text-slate-900">{businessName}</p>
            {invoice.trainer.publicEmail && <p className="text-xs text-slate-500">{invoice.trainer.publicEmail}</p>}
            {invoice.trainer.website && (
              <a href={invoice.trainer.website.startsWith('http') ? invoice.trainer.website : `https://${invoice.trainer.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline">
                {invoice.trainer.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Bill-to (name only) + status */}
        <div className="mt-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Invoice for</p>
            <p className="mt-0.5 text-sm font-medium text-slate-800">{invoice.client?.user?.name ?? 'You'}</p>
          </div>
          {isPaid ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Paid in full</span>
          ) : invoice.status === 'PARTIAL' ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Partially paid</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Due</span>
          )}
        </div>

        {/* Line items */}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-200">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium text-right w-14">Qty</th>
              <th className="py-2 font-medium text-right w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map(l => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-3 text-slate-700">{l.description}</td>
                <td className="py-3 text-right tabular-nums text-slate-500">{l.quantity}</td>
                <td className="py-3 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(l.amountCents, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex flex-col items-end gap-1.5">
          <div className="flex justify-between gap-12 text-sm w-full max-w-[240px]"><span className="text-slate-500">Total</span><span className="tabular-nums text-slate-700">{money(invoice.amountCents, cur)}</span></div>
          {invoice.amountPaidCents > 0 && (
            <div className="flex justify-between gap-12 text-sm w-full max-w-[240px]"><span className="text-slate-500">Amount paid</span><span className="tabular-nums text-emerald-600">− {money(invoice.amountPaidCents, cur)}</span></div>
          )}
          {surcharge > 0 && (
            <div className="flex justify-between gap-12 text-sm w-full max-w-[240px]"><span className="text-slate-500">Card processing fee</span><span className="tabular-nums text-slate-700">{money(surcharge, cur)}</span></div>
          )}
          <div className="flex justify-between gap-12 text-base font-bold w-full max-w-[240px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">{surcharge > 0 ? 'Total to pay' : 'Balance due'}</span><span className="tabular-nums text-slate-900">{money(payableTotal, cur)}</span></div>
          {surcharge > 0 && (
            <p className="text-[11px] text-slate-400 max-w-[240px] text-right leading-snug">Paying by card adds a processing fee.</p>
          )}
        </div>

        {/* Action */}
        <div className="mt-8">
          {isPaid ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">This invoice is paid in full. Thank you!</p>
          ) : paid ? (
            // Returned from Stripe with ?paid=1 but the webhook hasn't settled
            // yet — auto-confirm by polling the status endpoint (no manual refresh).
            <PaymentConfirm
              token={invoice.payToken!}
              currency={cur}
              amountCents={invoice.amountCents}
              initialAmountPaidCents={invoice.amountPaidCents}
            />
          ) : payable && canTakeCard ? (
            // Quotes what the card is actually charged: balance + surcharge
            // when the trainer passes the card fee on.
            <PayButton token={invoice.payToken!} label={`Pay ${money(payableTotal, cur)}`} />
          ) : (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
              Online card payment isn’t available for this invoice. Please contact {businessName} to arrange payment.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
