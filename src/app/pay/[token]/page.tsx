import { prisma } from '@/lib/prisma'
import { InvoiceDetail, invoiceDetailSelect } from './invoice-detail'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pay invoice', robots: { index: false, follow: false } }

// PUBLIC, no-login invoice pay page (/pay/<payToken>). Renders enough to pay —
// business identity, the line items, the balance due — and no more PII than
// needed (client name only; never their email/phone/address). The pay token is
// unguessable + the route is public in the middleware. The card itself is the
// shared <InvoiceDetail> (also used inside the signed-in client app); this page
// only adds the public full-screen chrome and the not-found / cancelled states.

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
    select: invoiceDetailSelect,
  })

  if (!invoice) {
    return <NeutralCard title="Invoice not found" body="This payment link is invalid or has expired. Please check with your trainer." />
  }
  if (invoice.status === 'CANCELLED') {
    return <NeutralCard title="Invoice cancelled" body="This invoice has been cancelled — no payment is needed." />
  }

  return (
    <Shell>
      <InvoiceDetail invoice={invoice} paid={!!paid} />
    </Shell>
  )
}
