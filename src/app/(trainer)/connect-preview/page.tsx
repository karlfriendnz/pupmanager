'use client'

import { useState } from 'react'
import { ConnectPaymentsPrompt, ConnectPaymentsModal } from '../settings/connect-payments-prompt'

// Throwaway preview of the connect-Stripe prompt that pops after creating a
// priced package/class — so the design can be viewed without going through the
// real flow or resetting account state. Visit /connect-preview.
export default function ConnectPreviewPage() {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="mx-auto max-w-xl p-8">
      <p className="mb-4 text-xs text-slate-400">
        Preview — the connect-Stripe prompt (not wired to your real account state).
      </p>

      <ConnectPaymentsPrompt onSkip={() => {}} />

      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="mt-6 text-sm font-medium text-teal-700 hover:underline"
      >
        Show as a popup modal →
      </button>

      {showModal && <ConnectPaymentsModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
