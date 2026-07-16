import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { InvoiceDetail, invoiceDetailSelect } from '@/app/pay/[token]/invoice-detail'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Invoice' }

// The signed-in client's copy of one invoice, INSIDE the app shell (so the left
// menu / bottom tabs stay put). Same card as the public /pay/<token> page — see
// invoice-detail.tsx — just without the full-screen public chrome.
//
// Security: the invoice is looked up by { payToken, clientId, trainerId }, all
// three from the session + active-trainer cookie (getActiveClient validates the
// profile against the user's own). The token is unguessable, but pinning the
// active client too means one client can never open another's invoice by URL,
// and matches the guard on the list (getActiveClientInvoices). A CANCELLED
// invoice — or any token that isn't this client's — bounces back to the list.

export default async function ClientInvoiceDetailPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ paid?: string }>
}) {
  const { token } = await params
  const { paid } = await searchParams

  const active = await getActiveClient()
  if (!active) redirect('/login')

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
  if (!profile) redirect('/login')

  const invoice = await prisma.invoice.findFirst({
    where: { payToken: token, clientId: profile.id, trainerId: profile.trainerId },
    select: invoiceDetailSelect,
  })
  // Not this client's invoice (or cancelled → nothing to pay/receipt) — send
  // them back to the list rather than showing a dead end.
  if (!invoice || invoice.status === 'CANCELLED') redirect('/my-invoices')

  return (
    <div className="px-4 md:px-8 pt-5 md:pt-8 pb-10 max-w-lg mx-auto w-full">
      <Link
        href="/my-invoices"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Invoices
      </Link>
      <InvoiceDetail invoice={invoice} paid={!!paid} />
    </div>
  )
}
