'use client'

import { type ReactNode } from 'react'
import {
  Users, PenLine, Send, LineChart, Trophy, Share2, Sparkles, Tag, ShoppingBag,
  Wallet, MapPin, Route, Clock, FileText, ListChecks, NotebookPen, Check,
  Download, Mail, CalendarDays, RefreshCw,
} from 'lucide-react'
import { FeaturePromoCard, FeaturePromoModal, PROMO_ICON, type PromoStep } from '@/components/shared/feature-promo'
import { EnableAddonButton } from '@/components/shared/enable-addon-button'
import { GoogleCalendarConnectCta } from '@/components/shared/google-calendar-connect-cta'
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
    image: { src: '/promo-achievements-v8.jpg', objectPosition: 'center 38%', translateX: '28%' },
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
    steps: [
      { icon: <Tag className={I} />, label: 'List items' },
      { icon: <ShoppingBag className={I} />, label: 'Client buys' },
      { icon: <Wallet className={I} />, label: 'You earn' },
    ],
    benefits: ['Your branding', 'One-tap checkout', 'Keep your margin'],
  },
  routeplanner: {
    title: 'Plan your day',
    description: 'The most efficient route between visits — and record the distance.',
    image: { src: '/promo-routeplanner-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    steps: [
      { icon: <MapPin className={I} />, label: 'Your visits' },
      { icon: <Route className={I} />, label: 'Best route' },
      { icon: <Clock className={I} />, label: 'Save time' },
    ],
    benefits: ['Record the distance', 'Drive-time from base', 'Cut the kilometres'],
  },
  googlecalendar: {
    title: 'On your Google Calendar',
    description: 'Your sessions, classes and blocked-out time — synced to Google.',
    image: { src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    steps: [
      { icon: <CalendarDays className={I} />, label: 'Connect Google' },
      { icon: <Clock className={I} />, label: 'Sessions & classes' },
      { icon: <RefreshCw className={I} />, label: 'Stays in sync' },
    ],
    benefits: ['One-way, private to you', 'Sessions, classes & blocked time', 'Updates on create, edit & cancel'],
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
    image: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
    steps: [
      { icon: <ListChecks className={I} />, label: 'Jot to-dos' },
      { icon: <NotebookPen className={I} />, label: 'Brain-dump' },
      { icon: <Check className={I} />, label: 'Tick off' },
    ],
    benefits: ['On your dashboard', 'Assign your team', 'Nothing slips'],
  },
  leadmagnets: {
    title: 'Grow your audience',
    description: 'A free download that captures emails to your mailing list.',
    image: { src: '/promo-leadmagnets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
    badge: chip('New subscriber'),
    steps: [
      { icon: <Download className={I} />, label: 'Free download' },
      { icon: <PenLine className={I} />, label: 'They sign up' },
      { icon: <Mail className={I} />, label: 'Emailed the file' },
      { icon: <Users className={I} />, label: 'Joins your list' },
    ],
    benefits: ['Branded sign-up page', 'Emailed automatically', 'Grows your mailing list'],
  },
  ai: {
    title: 'Your admin co-pilot',
    description: 'Turn rough notes into client-ready plans and updates.',
    image: { src: '/promo-ai-v1.jpg', objectPosition: 'center 38%', translateX: '28%' },
    steps: [
      { icon: <NotebookPen className={I} />, label: 'Rough notes' },
      { icon: <Sparkles className={I} />, label: 'AI drafts' },
      { icon: <Check className={I} />, label: 'You approve' },
    ],
    benefits: ['Drafts in seconds', 'You stay in control', 'Sunday-night saved'],
  },
  clientapp: {
    title: 'Your own client app',
    description: 'A branded app where clients follow their dog’s journey.',
    image: { src: '/hero-illustration.png', objectPosition: 'center 40%' },
    steps: [
      { icon: <Users className={I} />, label: 'Clients log in' },
      { icon: <FileText className={I} />, label: 'See sessions' },
      { icon: <Mail className={I} />, label: 'Message you' },
      { icon: <LineChart className={I} />, label: 'Track progress' },
    ],
    benefits: ['Branded in your colours', 'Sessions, homework & progress', 'Direct messaging'],
  },
  notes: {
    title: 'Notes on every session',
    description: 'Record write-ups and progress against each session.',
    image: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
    steps: [
      { icon: <Users className={I} />, label: 'Run the session' },
      { icon: <NotebookPen className={I} />, label: 'Write it up' },
      { icon: <LineChart className={I} />, label: 'See progress' },
    ],
    benefits: ['Per-session write-ups', 'Progress over time', 'Shareable with clients'],
  },
  classes: {
    title: 'Run group classes',
    description: 'Class cohorts with shared sessions and enrolments.',
    image: { src: '/promo-achievements-v8.jpg', objectPosition: 'center 38%', translateX: '28%' },
    steps: [
      { icon: <Users className={I} />, label: 'Create a class' },
      { icon: <Check className={I} />, label: 'Enrol clients' },
      { icon: <Clock className={I} />, label: 'Run weekly' },
    ],
    benefits: ['Shared class sessions', 'Enrolment tracking', 'Waitlist-ready'],
  },
  library: {
    title: 'Your training library',
    description: 'A reusable bank of exercises and tasks to drop into sessions.',
    image: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
    steps: [
      { icon: <ListChecks className={I} />, label: 'Build your library' },
      { icon: <FileText className={I} />, label: 'Drop into sessions' },
      { icon: <Users className={I} />, label: 'Assign as homework' },
    ],
    benefits: ['Reusable exercises', 'Session-ready', 'Assign as homework'],
  },
}

export const ADDON_PROMO_IDS = Object.keys(PROMOS)

// The hero image lookup lives in a server-safe module so server components (the
// add-on nudges) can call it too — this `'use client'` module can't be invoked
// during a server render. Re-exported here for the existing client callers.
export { addonPromoImage } from '@/lib/addon-promo-images'

function priceNote(addonId: string, currency: string): ReactNode {
  const def = addonById(addonId)
  if (def?.comingSoon) return <>Coming soon.</>
  if (def?.free) return <>Included free.</>
  const cur = isCurrencyCode(currency) ? currency : 'NZD'
  const price = def ? `${currencyMeta(cur).symbol}${def.price[cur]}/mo` : ''
  return <>Just <span className="font-semibold text-slate-700">{price}</span> · cancel anytime.</>
}

// Brand logo shown in the promo header's white tile (add-ons with a real logo).
function logoFor(addonId: string): ReactNode {
  const LOGOS: Record<string, string> = {
    googlecalendar: '/logos/google-calendar.webp',
  }
  const src = LOGOS[addonId]
  if (!src) return undefined
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-7 w-7 object-contain" />
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
  // Google Calendar has no settings page — connect AND disconnect live in this
  // popup via a connection-aware CTA.
  if (addonId === 'googlecalendar') return <GoogleCalendarConnectCta />
  // Xero still has its own settings tab — enable + jump to connect from here.
  if (addonId === 'xero') {
    return <EnableAddonButton itemId={addonId} label="Connect Xero" connectHref="/api/xero/connect" />
  }
  return <EnableAddonButton itemId={addonId} label={`Turn on ${def?.name ?? 'this add-on'}`} />
}

export function AddonPromoCard({ addonId, currency = 'NZD', onClose, cta }: { addonId: string; currency?: string; onClose: () => void; cta?: ReactNode }) {
  const cfg = PROMOS[addonId]
  if (!cfg) return null
  return <FeaturePromoCard {...cfg} eyebrow={addonById(addonId)?.name} logo={logoFor(addonId)} priceNote={priceNote(addonId, currency)} cta={cta ?? ctaFor(addonId)} onSkip={onClose} />
}

export function AddonPromoModal({ addonId, currency = 'NZD', onClose, cta }: { addonId: string; currency?: string; onClose: () => void; cta?: ReactNode }) {
  const cfg = PROMOS[addonId]
  if (!cfg) return null
  return <FeaturePromoModal {...cfg} eyebrow={addonById(addonId)?.name} logo={logoFor(addonId)} priceNote={priceNote(addonId, currency)} cta={cta ?? ctaFor(addonId)} onSkip={onClose} onClose={onClose} />
}
