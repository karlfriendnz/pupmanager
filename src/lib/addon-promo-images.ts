// Server-safe source of truth for add-on hero images.
//
// These are looked up from BOTH a client module (the Add-ons promo modal/cards
// in components/shared/addon-promos.tsx) AND server components (the add-on
// nudges on the Finances/Clients/Enquiries/Dashboard pages). `addon-promos.tsx`
// is `'use client'`, so its exports can't be called during a server render —
// hence this plain, directive-free module. Keep the entries here in step with
// the PROMOS map in addon-promos.tsx.

export type PromoImage = { src: string; objectPosition?: string; translateX?: string }

export const ADDON_PROMO_IMAGES: Record<string, PromoImage> = {
  marketing: { src: '/marketing-promo-v1.jpg', objectPosition: 'center 40%', translateX: '30%' },
  achievements: { src: '/promo-achievements-v8.jpg', objectPosition: 'center 38%', translateX: '28%' },
  shop: { src: '/promo-shop-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  routeplanner: { src: '/promo-routeplanner-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  googlecalendar: { src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  timesheets: { src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  todos: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
  leadmagnets: { src: '/promo-leadmagnets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  ai: { src: '/promo-ai-v1.jpg', objectPosition: 'center 38%', translateX: '28%' },
  clientapp: { src: '/hero-illustration.png', objectPosition: 'center 40%' },
  notes: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
  classes: { src: '/promo-achievements-v8.jpg', objectPosition: 'center 38%', translateX: '28%' },
  library: { src: '/promo-todos-v3.jpg', objectPosition: 'center 52%' },
  // Connect-based add-ons without a bespoke promo image — sensible reuse.
  payments: { src: '/promo-shop-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
  xero: { src: '/promo-timesheets-v1.jpg', objectPosition: 'center 40%', translateX: '28%' },
}

/** The hero image config for an add-on, or null if we don't have one. */
export function addonPromoImage(addonId: string): PromoImage | null {
  return ADDON_PROMO_IMAGES[addonId] ?? null
}
