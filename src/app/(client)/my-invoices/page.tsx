import { redirect } from 'next/navigation'
import { Receipt, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { getActiveClientInvoices, formatMoney, type ClientInvoiceView } from '@/lib/client-invoices'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Invoices' }

// The client's own invoice list. Before this page existed an invoice only
// reached the client as an emailed /pay/<token> link — lose the email, lose the
// ability to pay.
//
// Deliberately just a LIST: what it's for, when, how much, paid or not. Tapping
// a row opens the invoice's own in-app page (/my-invoices/<token>), which renders
// the shared invoice card — line-item detail, the card fee, Stripe checkout and
// the confirm/poll states — inside the app shell so the left menu stays. Same
// card as the public /pay/<token> page, no second invoice view, no second
// checkout.
//
// The amount shown for an unpaid invoice is what the client will actually be
// charged (balance + card fee when the trainer passes it on), from the same
// helper the pay page and the invoice email use — so the number never moves
// between this list and the card form.

function formatDate(d: Date) {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function StatusPill({ invoice }: { invoice: ClientInvoiceView }) {
  if (invoice.isPaid) {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Paid</span>
  }
  if (invoice.status === 'PARTIAL') {
    return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">Part paid</span>
  }
  return <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-600">Unpaid</span>
}

function InvoiceRow({ invoice, first }: { invoice: ClientInvoiceView; first: boolean }) {
  // Unpaid → what they'll actually be charged (incl. card fee). Paid → what they paid.
  const amount = invoice.isPaid
    ? invoice.amountPaidCents || invoice.amountCents
    : invoice.payableTotalCents
  const when = invoice.isPaid
    ? `Paid ${formatDate(invoice.paidAt ?? invoice.createdAt)}`
    : invoice.sentAt
      ? `Sent ${formatDate(invoice.sentAt)}`
      : `Raised ${formatDate(invoice.createdAt)}`

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{invoice.description ?? 'Invoice'}</p>
        <p className="mt-0.5 text-xs text-slate-500">{when}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2.5">
        <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${invoice.isPaid ? 'text-slate-500' : 'text-slate-900'}`}>
          {formatMoney(amount, invoice.currency)}
        </span>
        <StatusPill invoice={invoice} />
        <ChevronRight className="h-4 w-4 text-slate-300" />
      </div>
    </>
  )

  const cls = `flex items-center gap-3 px-4 py-3.5 ${first ? '' : 'border-t border-slate-100'}`

  // A legacy invoice with no pay token has nothing to open — render a plain row.
  return invoice.href
    ? <a href={invoice.href} data-testid={`invoice-${invoice.id}`} className={`${cls} hover:bg-slate-50 transition-colors`}>{body}</a>
    : <div data-testid={`invoice-${invoice.id}`} className={cls}>{body}</div>
}

export default async function MyInvoicesPage() {
  const data = await getActiveClientInvoices()
  if (!data) redirect('/login')

  const { outstanding, paid, totalOutstandingCents, currency } = data.summary
  // Unpaid first (they need action), then paid below as history.
  const rows = [...outstanding, ...paid]
  const subtitle = data.businessName ? `From ${data.businessName}` : 'Your invoices & receipts'

  return (
    <>
      <PageHeader title="Invoices" subtitle={subtitle} />

      {/* The client shell has no desktop top bar, so PageHeader's title only
          lands on mobile — give desktop its own (like /my-shop does). */}
      <div className="hidden md:block px-8 pt-8 max-w-3xl mx-auto w-full">
        <h1 className="font-display text-2xl font-bold text-slate-900">Invoices</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <div className="px-4 md:px-8 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-accent-soft flex items-center justify-center">
              <Receipt className="h-6 w-6 text-accent" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-700">No invoices yet</p>
            <p className="mt-1 text-xs text-slate-400">
              When {data.businessName ?? 'your trainer'} invoices you, it will show up here — with a way to pay it.
            </p>
          </div>
        ) : (
          <>
            {outstanding.length > 0 && (
              <div className="flex items-baseline justify-between gap-3 px-1">
                <p className="text-sm text-slate-500">
                  {outstanding.length} unpaid {outstanding.length === 1 ? 'invoice' : 'invoices'}
                </p>
                <p className="text-sm text-slate-500">
                  <span className="font-semibold tabular-nums text-slate-900">{formatMoney(totalOutstandingCents, currency)}</span> to pay
                </p>
              </div>
            )}

            <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
              {rows.map((inv, i) => <InvoiceRow key={inv.id} invoice={inv} first={i === 0} />)}
            </div>

            <p className="px-1 text-xs text-slate-400">
              Tap an invoice to see the detail{outstanding.length > 0 ? ' or pay it' : ''}.
            </p>
          </>
        )}
      </div>
    </>
  )
}
