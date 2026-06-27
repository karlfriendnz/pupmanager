'use client'

import { useState } from 'react'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import { AddonPromoModal, ADDON_PROMO_IDS } from '@/components/shared/addon-promos'

// Throwaway gallery of the feature/add-on promos (click a chip to open each as a
// modal). Not wired to real account state. Visit /connect-preview.
export default function ConnectPreviewPage() {
  const [open, setOpen] = useState<string | null>(null)
  const items = ['payments', ...ADDON_PROMO_IDS]

  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="mb-4 text-xs text-slate-400">
        Preview — add-on promos (click a chip to open it as a modal). Not wired to your account state.
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(id)}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium capitalize text-slate-700 hover:bg-slate-50"
          >
            {id}
          </button>
        ))}
      </div>

      {open === 'payments' && <ConnectPaymentsModal onClose={() => setOpen(null)} />}
      {open && open !== 'payments' && <AddonPromoModal addonId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
