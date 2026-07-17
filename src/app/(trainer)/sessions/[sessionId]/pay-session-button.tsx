'use client'

import { useState } from 'react'
import { CreditCard } from 'lucide-react'
import { SaleComposer, type SalePrefill } from '@/components/shared/sale-composer'

// "Take payment" on a session the client booked but hasn't paid for.
//
// The money owed already exists as an UNPAID Invoice — a pay-later booking
// still raises one ("payment not required" only skips the up-front Stripe
// charge). So this opens the sale composer pointed AT that invoice rather than
// starting a new sale, which would bill the same package twice. The trainer can
// add extras before showing the QR; the upsell lands on the same invoice.
//
// The parent resolves the invoice server-side and passes it in — null when
// there's nothing owed (already paid, or unpriced), in which case no button.
export function PaySessionButton({
  prefill,
  currency,
}: {
  prefill: SalePrefill
  currency: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--pm-brand-600)] bg-[var(--pm-brand-600)] px-3 py-3 text-white transition-colors hover:bg-[var(--pm-brand-700)]"
      >
        <CreditCard className="h-5 w-5" />
        <span className="text-xs font-semibold">Take payment</span>
      </button>

      <SaleComposer
        open={open}
        onClose={() => setOpen(false)}
        currency={currency}
        prefill={prefill}
      />
    </>
  )
}
