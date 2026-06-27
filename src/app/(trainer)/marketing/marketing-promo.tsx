'use client'

import { AddonPromoModal, AddonPromoCard } from '@/components/shared/addon-promos'

// Thin wrappers — the marketing promo now lives in the shared add-on registry.
export function MarketingPromoModal({ onClose, currency = 'NZD' }: { onClose: () => void; currency?: string }) {
  return <AddonPromoModal addonId="marketing" currency={currency} onClose={onClose} />
}

export function MarketingPromoCard({ onSkip, currency = 'NZD' }: { onSkip: () => void; currency?: string }) {
  return <AddonPromoCard addonId="marketing" currency={currency} onClose={onSkip} />
}
