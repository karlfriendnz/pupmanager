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
// Renders as a CELL in the session screen's action strip — same weight as its
// neighbours. It used to be a solid brand-teal block beside two outlined
// buttons, which read as decoration rather than hierarchy (AGENTS.md: colour is
// the trainer's, and it's rationed).
export function PaySessionButton({
  prefill,
  currency,
  accent,
}: {
  prefill: SalePrefill
  currency: string
  /** The trainer's brand colour, for the icon only. */
  accent?: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] items-center justify-center gap-2 px-2 py-3 text-[13px] font-medium text-slate-900 active:bg-slate-50"
      >
        <CreditCard
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={accent ? { color: `color-mix(in srgb, ${accent} 78%, #0f172a)` } : undefined}
          strokeWidth={1.75}
        />
        <span>Payment</span>
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
