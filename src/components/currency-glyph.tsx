'use client'

import { cn } from '@/lib/utils'
import { currencySymbol } from '@/lib/money'
import { useCurrency } from '@/components/currency-context'

/**
 * The active trainer's currency symbol as a bold text glyph — a drop-in for a
 * hardcoded `$` (lucide DollarSign) icon in payment/invoice badges. Text, not
 * an icon, so it covers symbols lucide has no icon for (e.g. ZAR "R"). Size it
 * with a text-size class in `className`; the parent handles centring.
 */
export function CurrencyGlyph({ className }: { className?: string }) {
  const sym = currencySymbol(useCurrency()) || '$'
  return (
    <span aria-hidden className={cn('font-bold leading-none', className)}>{sym}</span>
  )
}
