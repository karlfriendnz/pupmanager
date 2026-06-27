'use client'

import { ShieldCheck } from 'lucide-react'
import { FeaturePromoCard, FeaturePromoModal, PROMO_ICON, type FeaturePromoProps } from '@/components/shared/feature-promo'
import { currencyMeta, isCurrencyCode } from '@/lib/pricing'
import { ConnectButton } from './payments-actions'

// Payment-flow step icons.
function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={PROMO_ICON}>
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18a6 6 0 0 1 11 0" />
    </svg>
  )
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={PROMO_ICON}>
      <path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" />
    </svg>
  )
}
function IconCard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={PROMO_ICON}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" /><path d="M2.5 9.5h19" /><path d="M6 14.5h3.5" />
    </svg>
  )
}
function IconDollar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={PROMO_ICON}>
      <circle cx="12" cy="12" r="9" /><path d="M14.6 8.6c-.5-1-1.5-1.5-2.6-1.5-1.5 0-2.6.9-2.6 2.1s1.1 1.8 2.6 2 2.6.9 2.6 2.1-1.1 2-2.6 2c-1.1 0-2.1-.5-2.6-1.5" /><path d="M12 5.4v13.2" />
    </svg>
  )
}

// The floating "$" coin that drifts up off the phone in the photo.
const COIN = (
  <div className="animate-pm-coin pointer-events-none absolute bottom-[34%] right-[151px] z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#16a34a] text-white shadow-lg shadow-emerald-900/40 ring-2 ring-white/70">
    <span className="text-[15px] font-bold leading-none">$</span>
  </div>
)

const TRUST = (
  <>
    <ShieldCheck className="h-3.5 w-3.5" />
    <span>Bank-level secure · powered by</span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/stripe.svg" alt="Stripe" className="h-3.5 w-auto translate-y-[0.5px]" />
  </>
)

// Per-payment processing fee by payout currency. Mirrors the marketing pricing
// page (and lib/connect SURCHARGE_RATES) so the modal quotes the real cost.
const FEES: Record<string, { pct: string; fixed: number }> = {
  NZD: { pct: '3.5%', fixed: 30 },
  AUD: { pct: '2.7%', fixed: 30 },
  GBP: { pct: '2.5%', fixed: 20 },
  CAD: { pct: '3.9%', fixed: 30 },
  USD: { pct: '3.9%', fixed: 30 },
  ZAR: { pct: '3.9%', fixed: 50 },
}
function feeRate(currency: string): string {
  const cur = isCurrencyCode(currency) ? currency : 'NZD'
  const f = FEES[cur] ?? FEES.NZD
  const sym = currencyMeta(cur).symbol
  return `${f.pct} + ${sym}${(f.fixed / 100).toFixed(2)}`
}

// Everything except the CTA (which differs between page + modal use).
function paymentsConfig(currency: string): Omit<FeaturePromoProps, 'cta' | 'onSkip'> {
  return {
    title: 'Start getting paid',
    description: 'Let clients pay you in-app — money straight to your bank.',
    image: { src: '/get-paid-hero-v1.jpg', objectPosition: 'center 45%', translateX: '30%' },
    badge: COIN,
    steps: [
      { icon: <IconPerson />, label: 'Client signs up' },
      { icon: <IconDoc />, label: 'Invoice sent' },
      { icon: <IconCard />, label: 'Client pays' },
      { icon: <IconDollar />, label: 'You get paid' },
    ],
    benefits: ['Secure card payments', 'Money straight to your bank'],
    priceNote: (
      <>Clients pay the <span className="font-semibold text-slate-700">{feeRate(currency)}</span> fee on top of the invoice.</>
    ),
    trust: TRUST,
  }
}

const cta = <ConnectButton label="Connect Stripe & get paid" size="lg" fullWidth />

export function ConnectPaymentsPrompt({ onSkip, currency = 'NZD' }: { onSkip: () => void; currency?: string }) {
  return <FeaturePromoCard {...paymentsConfig(currency)} cta={cta} onSkip={onSkip} />
}

export function ConnectPaymentsModal({ onClose, currency = 'NZD' }: { onClose: () => void; currency?: string }) {
  return <FeaturePromoModal {...paymentsConfig(currency)} cta={cta} onSkip={onClose} onClose={onClose} />
}
