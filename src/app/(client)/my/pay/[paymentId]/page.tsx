import { redirect } from 'next/navigation'
import { CheckCircle2, Clock } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { PayNowButton } from './pay-now-button'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pay' }

function money(minor: number, currency: string): string {
  const sym: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
  return `${sym[currency.toLowerCase()] ?? ''}${(minor / 100).toFixed(2)}`
}

export default async function PayInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>
  searchParams: Promise<{ paid?: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')
  const { paymentId } = await params
  const { paid } = await searchParams

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId: active.clientId },
    select: {
      status: true, amountTotal: true, currency: true, description: true, amountRefunded: true,
      trainer: { select: { businessName: true } },
    },
  })
  if (!payment) redirect('/home')

  const isPaid = payment.status === 'PAID' || payment.status === 'PARTIALLY_REFUNDED' || payment.status === 'REFUNDED'
  // Just back from Stripe — the webhook may still be landing.
  const confirming = paid === '1' && payment.status === 'PENDING'

  return (
    <div className="px-5 pt-8 pb-10 max-w-md mx-auto w-full">
      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.06)] p-6 text-center">
        {isPaid ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-3 text-lg font-bold text-slate-900">Paid</h1>
            <p className="mt-1 text-sm text-slate-500">Thanks! Your payment to {payment.trainer.businessName} is complete.</p>
          </>
        ) : confirming ? (
          <>
            <Clock className="mx-auto h-12 w-12 text-amber-500" />
            <h1 className="mt-3 text-lg font-bold text-slate-900">Confirming your payment…</h1>
            <p className="mt-1 text-sm text-slate-500">This usually takes a few seconds. You can close this page — we’ll email your receipt.</p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{payment.trainer.businessName}</p>
            <h1 className="mt-2 text-base font-medium text-slate-700">{payment.description ?? 'Payment'}</h1>
            <p className="mt-3 text-4xl font-bold text-slate-900">{money(payment.amountTotal, payment.currency)}</p>
            <div className="mt-6">
              <PayNowButton paymentId={paymentId} />
            </div>
            <p className="mt-3 text-[11px] text-slate-400">Secure checkout via Stripe.</p>
          </>
        )}
      </div>
    </div>
  )
}
