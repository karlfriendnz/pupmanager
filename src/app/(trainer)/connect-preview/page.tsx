'use client'

import { useState } from 'react'
import { ConnectPaymentsPrompt, ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import { MarketingPromoModal } from '../marketing/marketing-promo'

// Throwaway preview of the reusable feature-promo modal (payments shown inline;
// buttons open each add-on's promo as a modal). Visit /connect-preview.
export default function ConnectPreviewPage() {
  const [modal, setModal] = useState<null | 'payments' | 'marketing'>(null)

  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="mb-4 text-xs text-slate-400">
        Preview — the reusable feature-promo (not wired to your real account state).
      </p>

      <ConnectPaymentsPrompt onSkip={() => {}} />

      <div className="mt-6 flex gap-4">
        <button type="button" onClick={() => setModal('payments')} className="text-sm font-medium text-teal-700 hover:underline">
          Payments modal →
        </button>
        <button type="button" onClick={() => setModal('marketing')} className="text-sm font-medium text-teal-700 hover:underline">
          Marketing modal →
        </button>
      </div>

      {modal === 'payments' && <ConnectPaymentsModal onClose={() => setModal(null)} />}
      {modal === 'marketing' && <MarketingPromoModal onClose={() => setModal(null)} />}
    </div>
  )
}
