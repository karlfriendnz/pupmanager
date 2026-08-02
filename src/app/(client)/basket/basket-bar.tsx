'use client'

import { Check, ShoppingBag } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { useCurrency } from '@/components/currency-context'
import { useBasket } from './basket-context'
import { BasketSheet } from './basket-sheet'

/**
 * The persistent count — the only part of the basket that is always on screen.
 *
 * A PILL, NOT A HEADER ICON. The client shell's top bar is shared with the
 * trainer app and already carries the business name, the bell and the menu; a
 * fourth thing squeezed in there is unreachable with a thumb. This sits above
 * the bottom tab bar where the thumb already is, and it only exists when there
 * is something in the basket — an empty basket icon following you around every
 * screen is chrome that hasn't earned its space.
 *
 * Tapping it opens the review screen (a full screen on a phone). Adding
 * something does NOT: the whole point of the feature is that a client can add
 * three things and pay once, so an add confirms itself here for a couple of
 * seconds and leaves them exactly where they were shopping.
 */
export function BasketBar() {
  const basket = useBasket()
  const currency = useCurrency()

  // An empty basket has nothing to say. (During hydration the store's server
  // snapshot is empty too, so this renders nothing until the real basket is
  // read — no mismatch, no flash of a wrong count.)
  if (basket.count === 0) return null

  return (
    <>
      <div
        // Above the mobile tab bar (5rem + the phone's safe area); the desktop
        // has no bottom bar, so it sits in the corner.
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-40 flex justify-center px-4 md:inset-x-auto md:bottom-6 md:right-6 md:justify-end md:px-0"
      >
        <div className="pointer-events-auto flex max-w-full flex-col items-stretch gap-2">
          {basket.justAdded && (
            <p className="truncate rounded-full bg-slate-900/90 px-3.5 py-1.5 text-center text-xs font-medium text-white shadow-lg">
              <Check className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} />
              Added {basket.justAdded}
            </p>
          )}
          <button
            type="button"
            onClick={basket.open}
            className="inline-flex items-center gap-2.5 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-fg shadow-[0_8px_24px_rgba(15,31,36,0.22)]"
          >
            <span className="relative flex items-center">
              <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold tabular-nums text-slate-900">
                {basket.count}
              </span>
            </span>
            <span>View basket</span>
            <span className="tabular-nums opacity-80">{formatMoney(basket.subtotalCents, currency)}</span>
          </button>
        </div>
      </div>

      {basket.isOpen && <BasketSheet />}
    </>
  )
}
