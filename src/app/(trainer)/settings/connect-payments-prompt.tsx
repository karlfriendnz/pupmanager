'use client'

import { ConnectButton } from './payments-actions'

/**
 * Post-create nudge to connect Stripe so a just-priced item (a package or a
 * class) can be paid for in-app. Shows the Stripe wordmark, the real Connect
 * onboarding button, and a skip. Shared by the New-package page and the class
 * form modal so the two stay identical.
 */
export function ConnectPaymentsPrompt({
  title,
  description,
  onSkip,
}: {
  title: string
  description: string
  onSkip: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-4 w-fit rounded-xl bg-white px-4 py-2.5 ring-1 ring-slate-200 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stripe.svg" alt="Stripe" className="h-7 w-auto" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>
      <div className="mt-5 flex flex-col items-center gap-3">
        <ConnectButton label="Connect Stripe" />
        <button
          type="button"
          onClick={onSkip}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Skip for now
        </button>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        You can always set this up later in Settings → Payments.
      </p>
    </div>
  )
}

/**
 * The same prompt as a centered modal overlay — used on the packages / classes
 * list pages after a priced item is created, so the trainer sees the new item
 * behind the popup.
 */
export function ConnectPaymentsModal({
  title,
  description,
  onClose,
}: {
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md">
        <ConnectPaymentsPrompt title={title} description={description} onSkip={onClose} />
      </div>
    </div>
  )
}
