import { type ReactNode } from 'react'
import { Mail, Download, Route, Trophy, ShoppingBag, Clock } from 'lucide-react'
import { addonPromoImage } from '@/lib/addon-promo-images'
import { NUDGE_COPY, nudgeCtaHref } from '@/lib/addon-nudges'

// A real brand logo image in the nudge's white badge tile (square marks only).
function Logo({ src, alt, className }: { src: string; alt: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`${className} object-contain`} />
}

// Square brand marks for Stripe + Xero (their supplied assets are wide
// wordmarks; these are the app-icon-style square glyphs to match Google's).
function StripeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#635BFF" />
      <path fill="#fff" d="M14.6 13c0-.86.7-1.19 1.86-1.19 1.66 0 3.76.5 5.42 1.4V8.13a14.4 14.4 0 0 0-5.42-1c-4.43 0-7.38 2.32-7.38 6.2 0 6.04 8.32 5.08 8.32 7.68 0 1.02-.88 1.35-2.1 1.35-1.82 0-4.14-.75-5.98-1.76v4.9a15.2 15.2 0 0 0 5.98 1.25c4.54 0 7.66-2.24 7.66-6.17 0-6.52-8.36-5.36-8.36-7.78Z" />
    </svg>
  )
}
function XeroGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <circle cx="16" cy="16" r="16" fill="#13B5EA" />
      <path d="M11 11.5 21 20.5M21 11.5 11 20.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

// Presentational half of the add-on nudge registry: it layers icons + hero art
// onto the React-free copy/selection logic in `@/lib/addon-nudges` (which is
// where the unit tests live). Pages call `addonNudge(id)` for content and pass
// their own AddonNudge `id` (a page-specific dismissal key) + `forceShow`.
//
// Re-export the selection helpers so server components can import everything
// from one place.
export { PROMOTABLE_ADDON_IDS, eligibleNudgeAddonIds, pickNudgeAddonId } from '@/lib/addon-nudges'

export interface AddonNudgeContent {
  /** The pricing.ts add-on id this nudge promotes (also spread onto AddonNudge,
   *  which ignores it — the call site supplies the real dismissal `id`). */
  addonId: string
  title: string
  body: string
  ctaLabel: string
  ctaHref: string
  image?: { src: string; objectPosition?: string; translateX?: string }
  icon?: ReactNode
}

const ICON: Record<string, ReactNode> = {
  googlecalendar: <Logo src="/logos/google-calendar.webp" alt="Google Calendar" className="h-6 w-6" />,
  payments: <StripeGlyph className="h-6 w-6" />,
  xero: <XeroGlyph className="h-6 w-6" />,
  marketing: <Mail className="h-5 w-5 text-teal-600" />,
  leadmagnets: <Download className="h-5 w-5 text-teal-600" />,
  routeplanner: <Route className="h-5 w-5 text-teal-600" />,
  achievements: <Trophy className="h-5 w-5 text-teal-600" />,
  shop: <ShoppingBag className="h-5 w-5 text-teal-600" />,
  timesheets: <Clock className="h-5 w-5 text-teal-600" />,
}

/** The nudge content for an add-on, or null if we don't promote it. */
export function addonNudge(addonId: string): AddonNudgeContent | null {
  const copy = NUDGE_COPY[addonId]
  if (!copy) return null
  return {
    addonId,
    title: copy.title,
    body: copy.body,
    ctaLabel: copy.ctaLabel,
    ctaHref: nudgeCtaHref(addonId),
    // Server-safe lookup; covers payments/xero too (see addon-promo-images.ts).
    image: addonPromoImage(addonId) ?? undefined,
    icon: ICON[addonId],
  }
}
