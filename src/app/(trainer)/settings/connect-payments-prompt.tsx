'use client'

import { Fragment } from 'react'
import { ConnectButton } from './payments-actions'

// "How you get paid" flow strip — the soft tinted-circle concept, inline so it
// stays crisp + themeable (no asset file). Client signs up → Invoice sent →
// Client pays → You get paid.
const FLOW_ICON = 'h-[22px] w-[22px]'
function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={FLOW_ICON}>
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18a6 6 0 0 1 11 0" />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={FLOW_ICON}>
      <path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" />
    </svg>
  )
}
function IconCard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={FLOW_ICON}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" /><path d="M2.5 9.5h19" /><path d="M6 14.5h3.5" />
    </svg>
  )
}
function IconDollar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={FLOW_ICON}>
      <circle cx="12" cy="12" r="9" /><path d="M14.6 8.6c-.5-1-1.5-1.5-2.6-1.5-1.5 0-2.6.9-2.6 2.1s1.1 1.8 2.6 2 2.6.9 2.6 2.1-1.1 2-2.6 2c-1.1 0-2.1-.5-2.6-1.5" /><path d="M12 5.4v13.2" />
    </svg>
  )
}
function FlowArrow() {
  return (
    <svg viewBox="0 0 40 24" fill="none" stroke="#2A9DA9" strokeLinecap="round" strokeLinejoin="round" className="mt-[16px] h-4 w-7 shrink-0">
      <path d="M3 12h27" strokeWidth={2.2} strokeDasharray="0.1 6" /><path d="M27 7l8 5-8 5" strokeWidth={2} />
    </svg>
  )
}
function GetPaidFlow() {
  const steps: [string, React.ReactNode][] = [
    ['Client signs up', <IconPerson key="p" />],
    ['Invoice sent', <IconDoc key="d" />],
    ['Client pays', <IconCard key="c" />],
    ['You get paid', <IconDollar key="$" />],
  ]
  return (
    <div className="flex items-start justify-center gap-1">
      {steps.map(([label, icon], i) => (
        <Fragment key={label}>
          <div className="flex w-[70px] flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAF6F5] text-[#1F818C] ring-1 ring-[#2A9DA9]/20">
              {icon}
            </div>
            <span className="text-center text-[10px] font-medium leading-tight text-slate-600">{label}</span>
          </div>
          {i < 3 && <FlowArrow />}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * Post-create nudge to connect Stripe so a just-priced item (a package or a
 * class) can be paid for in-app. Shows the Stripe wordmark, a "how you get
 * paid" flow strip, the real Connect onboarding button, and a skip. Shared by
 * the New-package page and the class form modal so the two stay identical.
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
      <div className="mt-5 border-t border-slate-100 pt-5">
        <GetPaidFlow />
      </div>
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
