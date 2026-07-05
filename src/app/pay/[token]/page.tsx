import { prisma } from '@/lib/prisma'
import { PayButton } from './pay-button'
import { PaymentConfirm } from './payment-confirm'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pay invoice', robots: { index: false, follow: false } }

// PUBLIC, no-login invoice pay page (/pay/<payToken>). Renders enough to pay —
// business identity, the line items, the balance due — and no more PII than
// needed (client name only; never their email/phone/address). The pay token is
// unguessable + the route is public in the middleware.

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 flex justify-center">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  )
}

function NeutralCard({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
      </div>
    </Shell>
  )
}

export default async function PayPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ paid?: string }>
}) {
  const { token } = await params
  const { paid } = await searchParams

  const invoice = await prisma.invoice.findUnique({
    where: { payToken: token },
    select: {
      amountCents: true, amountPaidCents: true, currency: true, status: true, description: true, createdAt: true,
      payToken: true,
      lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, description: true, quantity: true, unitAmountCents: true, amountCents: true } },
      client: { select: { user: { select: { name: true } } } },
      trainer: {
        select: {
          businessName: true, logoUrl: true, publicEmail: true, website: true, acceptPaymentsEnabled: true, connectChargesEnabled: true,
        },
      },
    },
  })

  if (!invoice) {
    return <NeutralCard title="Invoice not found" body="This payment link is invalid or has expired. Please check with your trainer." />
  }
  if (invoice.status === 'CANCELLED') {
    return <NeutralCard title="Invoice cancelled" body="This invoice has been cancelled — no payment is needed." />
  }

  const balance = Math.max(0, invoice.amountCents - invoice.amountPaidCents)
  const isPaid = invoice.status === 'PAID' || balance <= 0
  const payable = !isPaid && (invoice.status === 'UNPAID' || invoice.status === 'PARTIAL')
  const canTakeCard = !!(invoice.trainer.acceptPaymentsEnabled && invoice.trainer.connectChargesEnabled)
  const cur = invoice.currency
  const businessName = invoice.trainer.businessName ?? 'Your trainer'

  return (
    <Shell>
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
            <div className="flex justify-between gap-12 text-base font-bold w-full max-w-[240px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">Balance due</span><span className="tabular-nums text-slate-900">{money(balance, cur)}</span></div>
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
              <PayButton token={invoice.payToken!} label={`Pay ${money(balance, cur)}`} />
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
                Online card payment isn’t available for this invoice. Please contact {businessName} to arrange payment.
              </p>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
