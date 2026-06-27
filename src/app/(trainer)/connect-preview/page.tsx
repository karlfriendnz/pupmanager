'use client'

import { useState } from 'react'
import { ConnectPaymentsPrompt, ConnectPaymentsModal } from '../settings/connect-payments-prompt'

// Throwaway preview of the connect-Stripe prompt that pops after creating a
// priced package/class — so the design can be viewed without going through the
// real flow or resetting account state. Visit /connect-preview.
export default function ConnectPreviewPage() {
  const [showModal, setShowModal] = useState(false)
  const desc =
    '“Puppy Foundations” has a price. Connect your Stripe account so clients can pay for it right inside PupManager — secure card payments, paid straight to your bank.'

  return (
    <div className="mx-auto max-w-md p-8">
      <p className="mb-4 text-xs text-slate-400">
        Preview — the connect-Stripe prompt (not wired to your real account state).
      </p>

      {/* Inline (page-mode) prompt */}
      <ConnectPaymentsPrompt title="Package created 🎉" description={desc} onSkip={() => {}} />

      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="mt-6 text-sm font-medium text-teal-700 hover:underline"
      >
        Show as a popup modal →
      </button>

      {showModal && (
        <ConnectPaymentsModal title="Package created 🎉" description={desc} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}
