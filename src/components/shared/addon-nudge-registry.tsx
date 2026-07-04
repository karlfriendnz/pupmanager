import { type ReactNode } from 'react'
import { Mail, Download, CreditCard, Route, Trophy, ShoppingBag, Clock, Calculator } from 'lucide-react'
import { GoogleGlyph } from './addon-nudge'
import { addonPromoImage } from '@/lib/addon-promo-images'
import { NUDGE_COPY, nudgeCtaHref } from '@/lib/addon-nudges'

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
  googlecalendar: <GoogleGlyph className="h-5 w-5" />,
  marketing: <Mail className="h-5 w-5 text-teal-600" />,
  leadmagnets: <Download className="h-5 w-5 text-teal-600" />,
  payments: <CreditCard className="h-5 w-5 text-teal-600" />,
  routeplanner: <Route className="h-5 w-5 text-teal-600" />,
  achievements: <Trophy className="h-5 w-5 text-teal-600" />,
  shop: <ShoppingBag className="h-5 w-5 text-teal-600" />,
  timesheets: <Clock className="h-5 w-5 text-teal-600" />,
  xero: <Calculator className="h-5 w-5 text-teal-600" />,
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
