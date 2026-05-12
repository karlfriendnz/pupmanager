import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Checkout cancelled · PupManager' }

// Stripe sends the trainer here if they bail out of Checkout. No charge,
// no state change — just give them a soft landing and a link back to the
// plan picker so they can try again whenever.
export default function BillingCancelPage() {
  return (
    <div className="p-4 md:p-8 w-full max-w-xl mx-auto text-center">
      <div className="mt-6 rounded-3xl bg-white border border-slate-100 shadow-sm p-10">
        <div className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-slate-100 text-slate-600 mb-4">
          <Info className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">No worries — no charge</h1>
        <p className="mt-2 text-sm text-slate-600 leading-snug">
          You backed out before paying. Your account stays exactly as it was.
        </p>
        <p className="mt-1 text-sm text-slate-500 leading-snug">
          Whenever you&apos;re ready, the plans page is right here.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/billing/setup">
            <Button>Try again</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
