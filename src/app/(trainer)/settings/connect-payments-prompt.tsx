'use client'

import { Fragment } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { ConnectButton } from './payments-actions'

// "How you get paid" flow strip — the soft tinted-circle concept, inline so it
// stays crisp + themeable (no asset file). Client signs up → Invoice sent →
// Client pays → You get paid.
const FLOW_ICON = 'h-9 w-9'
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
    <svg viewBox="0 0 40 24" fill="none" stroke="#2A9DA9" strokeLinecap="round" strokeLinejoin="round" className="mt-[26px] h-5 w-8 shrink-0">
      <path d="M3 12h28" strokeWidth={2.4} strokeDasharray="0.1 6.5" /><path d="M28 6l9 6-9 6" strokeWidth={2.2} />
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
          <div className="flex w-24 flex-col items-center gap-3">
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#EAF6F5] text-[#1F818C] ring-1 ring-[#2A9DA9]/15">
              {icon}
            </div>
            <span className="text-center text-[13px] font-semibold leading-tight text-slate-800">{label}</span>
          </div>
          {i < 3 && <FlowArrow />}
        </Fragment>
      ))}
    </div>
  )
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-4 w-4 text-[#1F818C]" strokeWidth={2.5} />
      {children}
    </span>
  )
}

/**
 * Conversion-focused nudge to turn on Stripe payments — shown after a trainer
 * prices a package/class while not yet connected. Leads with the benefit (get
 * paid), shows the how-it-works flow, and a bold Connect CTA. Shared by the
 * packages/classes list (as a modal) and the preview page.
 */
export function ConnectPaymentsPrompt({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
      {/* Branded gradient header — text left, photo bleeding to fill the full
          height of the teal box on the right (matches the marketing pricing
          hero). */}
      <div
        className="relative flex overflow-hidden text-white"
        style={{ backgroundImage: 'linear-gradient(135deg, #2A9DA9, #1F818C)' }}
      >
        <div className="relative z-10 flex-1 py-9 pl-8 pr-5">
          <h2 className="text-[26px] font-bold leading-tight tracking-tight">Start getting paid 💸</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-white/90">
            Switch on payments and your clients can pay you for packages, sessions
            and shop items right inside PupManager — straight to your bank.
          </p>
        </div>
        <div className="relative w-[38%] shrink-0 self-stretch">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/get-paid-hero-v1.jpg"
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover object-[72%_center]"
          />
          {/* teal overlay fading across the whole image — full on the left
              edge (blends into the box) → clear on the right */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundImage: 'linear-gradient(90deg, #1F818C 0%, rgba(31,129,140,0) 100%)' }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="px-8 py-8">
        <GetPaidFlow />

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-[13px] font-medium text-slate-500">
          <Benefit>Secure card payments</Benefit>
          <Benefit>Money to your bank</Benefit>
          <Benefit>No monthly fees</Benefit>
        </div>

        <div className="mt-7 flex flex-col items-center gap-3">
          <ConnectButton label="Connect Stripe & get paid" size="lg" fullWidth />
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Bank-level secure · powered by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/stripe.svg" alt="Stripe" className="h-3.5 w-auto translate-y-[0.5px]" />
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="mt-1 text-sm font-medium text-slate-400 hover:text-slate-600"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The same prompt as a centered modal overlay — used on the packages / classes
 * list pages after a priced item is created, so the trainer sees the new item
 * behind the popup.
 */
export function ConnectPaymentsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-xl">
        <ConnectPaymentsPrompt onSkip={onClose} />
      </div>
    </div>
  )
}
