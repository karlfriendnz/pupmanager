'use client'

import { Users, PenLine, Send, LineChart } from 'lucide-react'
import { FeaturePromoCard, FeaturePromoModal, PROMO_ICON, type FeaturePromoProps } from '@/components/shared/feature-promo'
import { EnableAddonButton } from '@/components/shared/enable-addon-button'
import { addonById, currencyMeta, isCurrencyCode } from '@/lib/pricing'

// Floating "email opened" chip over the photo (echoes the tracking benefit).
const CHIP = (
  <div className="animate-pm-pop pointer-events-none absolute bottom-[32%] right-[16%] z-20 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-lg shadow-slate-900/25">
    <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
    Email opened
  </div>
)

function priceLabel(currency: string): string {
  const cur = isCurrencyCode(currency) ? currency : 'NZD'
  const a = addonById('marketing')
  const sym = currencyMeta(cur).symbol
  return a ? `${sym}${a.price[cur]}/mo` : ''
}

function marketingConfig(currency: string): Omit<FeaturePromoProps, 'cta' | 'onSkip'> {
  return {
    title: 'Reach more clients 📣',
    description: 'Email all your clients in one go.',
    image: { src: '/marketing-promo-v1.jpg', objectPosition: 'center 40%', translateX: '30%' },
    badge: CHIP,
    steps: [
      { icon: <Users className={PROMO_ICON} />, label: 'Pick clients' },
      { icon: <PenLine className={PROMO_ICON} />, label: 'Compose' },
      { icon: <Send className={PROMO_ICON} />, label: 'Send' },
      { icon: <LineChart className={PROMO_ICON} />, label: 'Track opens' },
    ],
    benefits: ['Your brand', 'Open & click tracking', 'From your domain'],
    priceNote: (
      <>Just <span className="font-semibold text-slate-700">{priceLabel(currency)}</span> · cancel anytime.</>
    ),
  }
}

const cta = <EnableAddonButton itemId="marketing" label="Turn on Marketing" />

export function MarketingPromoCard({ onSkip, currency = 'NZD' }: { onSkip: () => void; currency?: string }) {
  return <FeaturePromoCard {...marketingConfig(currency)} cta={cta} onSkip={onSkip} />
}

export function MarketingPromoModal({ onClose, currency = 'NZD' }: { onClose: () => void; currency?: string }) {
  return <FeaturePromoModal {...marketingConfig(currency)} cta={cta} onSkip={onClose} onClose={onClose} />
}
