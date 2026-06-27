'use client'

import { Users, PenLine, Send, LineChart } from 'lucide-react'
import { FeaturePromoCard, FeaturePromoModal, PROMO_ICON, type FeaturePromoProps } from '@/components/shared/feature-promo'
import { EnableAddonButton } from '@/components/shared/enable-addon-button'

// Floating "email opened" chip over the photo (echoes the tracking benefit).
const CHIP = (
  <div className="animate-pm-pop pointer-events-none absolute bottom-[32%] right-[16%] z-20 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-lg shadow-slate-900/25">
    <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
    Email opened
  </div>
)

const MARKETING: Omit<FeaturePromoProps, 'cta' | 'onSkip'> = {
  title: 'Reach more clients 📣',
  description: 'Email your clients from your own brand — with open & click tracking.',
  image: { src: '/marketing-promo-v1.jpg', objectPosition: 'center 40%', translateX: '30%' },
  badge: CHIP,
  steps: [
    { icon: <Users className={PROMO_ICON} />, label: 'Pick clients' },
    { icon: <PenLine className={PROMO_ICON} />, label: 'Compose' },
    { icon: <Send className={PROMO_ICON} />, label: 'Send' },
    { icon: <LineChart className={PROMO_ICON} />, label: 'Track opens' },
  ],
  benefits: ['Your brand', 'Open & click tracking', 'From your domain'],
  trust: <span>Billed monthly · cancel anytime</span>,
}

const cta = <EnableAddonButton itemId="marketing" label="Turn on Marketing" />

export function MarketingPromoCard({ onSkip }: { onSkip: () => void }) {
  return <FeaturePromoCard {...MARKETING} cta={cta} onSkip={onSkip} />
}

export function MarketingPromoModal({ onClose }: { onClose: () => void }) {
  return <FeaturePromoModal {...MARKETING} cta={cta} onSkip={onClose} onClose={onClose} />
}
