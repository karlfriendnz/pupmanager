'use client'

import { type ReactNode } from 'react'
import {
  Users, PenLine, Send, LineChart, Trophy, Share2, Sparkles, Tag, ShoppingBag,
  Wallet, MapPin, Route, Clock, FileText, ListChecks, NotebookPen, Check,
} from 'lucide-react'
import { FeaturePromoCard, FeaturePromoModal, PROMO_ICON, type PromoStep } from '@/components/shared/feature-promo'
import { EnableAddonButton } from '@/components/shared/enable-addon-button'
import { Button } from '@/components/ui/button'
import { addonById, currencyMeta, isCurrencyCode } from '@/lib/pricing'

// One promo config per toggleable add-on. They all render through the shared
// FeaturePromo shell; the price line + CTA are derived from pricing.ts so free /
// paid / coming-soon all behave correctly. (Payments has its own bespoke promo
// because it onboards Stripe rather than toggling an add-on.)

const I = PROMO_ICON

function chip(label: string): ReactNode {
  return (
    <div className="animate-pm-pop pointer-events-none absolute bottom-[32%] right-[16%] z-20 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-lg shadow-slate-900/25">
      <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
      {label}
    </div>
  )
}

type Cfg = {
  title: string
  description: string
  image: { src: string; objectPosition?: string; translateX?: string }
  badge?: ReactNode
  steps: PromoStep[]
  benefits: string[]
}

const PROMOS: Record<string, Cfg> = {
  marketing: {
    title: 'Reach more clients',
    description: 'Email all your clients in one go.',
    image: { src: '/marketing-promo-v1.jpg', objectPosition: 'center 40%', translateX: '30%' },
    badge: chip('Email opened'),
    steps: [
      { icon: <Users className={I} />, label: 'Pick clients' },
      { icon: <PenLine className={I} />, label: 'Compose' },
      { icon: <Send className={I} />, label: 'Send' },
      { icon: <LineChart className={I} />, label: 'Track opens' },
    ],
    benefits: ['Your brand', 'Open & click tracking', 'From your domain'],
  },
  achievements: {
    title: 'Celebrate every win',
    description: 'Branded badges your clients earn and show off.',
    image: { src: '/promo-achievements-v4.jpg', objectPosition: 'center 40%', translateX: '15%' },
    badge: chip('Badge earned'),
    steps: [
      { icon: <Trophy className={I} />, label: 'Earn badges' },
      { icon: <Share2 className={I} />, label: 'Clients share' },
      { icon: <Sparkles className={I} />, label: 'You get seen' },
    ],
    benefits: ['Branded badges', 'Clients share wins', 'Free marketing'],
  },
  shop: {
    title: 'Sell to your clients',
    description: 'An in-app shop for the extras they already ask for.',
    image: { src: '/promo-shop-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    badge: chip('New sale'),
    steps: [
      { icon: <Tag className={I} />, label: 'List items' },
      { icon: <ShoppingBag className={I} />, label: 'Client buys' },
      { icon: <Wallet className={I} />, label: 'You earn' },
    ],
    benefits: ['Your branding', 'One-tap checkout', 'Keep your margin'],
  },
  routeplanner: {
    title: 'Plan your day',
    description: 'The most efficient route between your home visits.',
    image: { src: '/promo-routeplanner-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    badge: chip('18 min saved'),
    steps: [
      { icon: <MapPin className={I} />, label: 'Your visits' },
      { icon: <Route className={I} />, label: 'Best route' },
      { icon: <Clock className={I} />, label: 'Save time' },
    ],
    benefits: ['Drive-time from base', 'Order your day', 'Cut the kilometres'],
  },
  timesheets: {
    title: 'Track your team’s hours',
    description: 'Turn worked time into payroll-ready totals.',
    image: { src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    steps: [
      { icon: <Clock className={I} />, label: 'Log hours' },
      { icon: <Users className={I} />, label: 'Team time' },
      { icon: <FileText className={I} />, label: 'Payroll-ready' },
    ],
    benefits: ['Staff clock in', 'Owner approves', 'Payroll-ready totals'],
  },
  todos: {
    title: 'Nothing slips',
    description: 'A quick to-do list and brain-dump on your dashboard.',
    image: { src: '/promo-todos-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    steps: [
      { icon: <ListChecks className={I} />, label: 'Jot to-dos' },
      { icon: <NotebookPen className={I} />, label: 'Brain-dump' },
      { icon: <Check className={I} />, label: 'Tick off' },
    ],
    benefits: ['On your dashboard', 'Assign your team', 'Nothing slips'],
  },
  ai: {
    title: 'Your admin co-pilot',
    description: 'Turn rough notes into client-ready plans and updates.',
    image: { src: '/promo-ai-v1.jpg', objectPosition: 'center 38%', translateX: '28%' },
    badge: chip('Draft ready'),
    steps: [
      { icon: <NotebookPen className={I} />, label: 'Rough notes' },
      { icon: <Sparkles className={I} />, label: 'AI drafts' },
      { icon: <Check className={I} />, label: 'You approve' },
    ],
    benefits: ['Drafts in seconds', 'You stay in control', 'Sunday-night saved'],
  },
}

export const ADDON_PROMO_IDS = Object.keys(PROMOS)

function priceNote(addonId: string, currency: string): ReactNode {
  const def = addonById(addonId)
  if (def?.comingSoon) return <>Coming soon.</>
  if (def?.free) return <>Included free.</>
  const cur = isCurrencyCode(currency) ? currency : 'NZD'
  const price = def ? `${currencyMeta(cur).symbol}${def.price[cur]}/mo` : ''
  return <>Just <span className="font-semibold text-slate-700">{price}</span> · cancel anytime.</>
}

function ctaFor(addonId: string): ReactNode {
  const def = addonById(addonId)
  if (def?.comingSoon) {
    return (
      <div className="w-full">
        <Button type="button" size="lg" className="w-full" disabled>Coming soon</Button>
      </div>
    )
  }
  return <EnableAddonButton itemId={addonId} label={`Turn on ${def?.name ?? 'this add-on'}`} />
}

export function AddonPromoCard({ addonId, currency = 'NZD', onClose }: { addonId: string; currency?: string; onClose: () => void }) {
  const cfg = PROMOS[addonId]
  if (!cfg) return null
  return <FeaturePromoCard {...cfg} priceNote={priceNote(addonId, currency)} cta={ctaFor(addonId)} onSkip={onClose} />
}

export function AddonPromoModal({ addonId, currency = 'NZD', onClose }: { addonId: string; currency?: string; onClose: () => void }) {
  const cfg = PROMOS[addonId]
  if (!cfg) return null
  return <FeaturePromoModal {...cfg} priceNote={priceNote(addonId, currency)} cta={ctaFor(addonId)} onSkip={onClose} onClose={onClose} />
}
