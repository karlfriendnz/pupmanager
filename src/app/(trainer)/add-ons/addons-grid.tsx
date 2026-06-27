'use client'

import { useState } from 'react'
import { currencyMeta, type CurrencyCode } from '@/lib/pricing'
import { AddonPromoModal, addonPromoImage } from '@/components/shared/addon-promos'

export interface AddonCard {
  id: string
  name: string
  blurb: string
  badge: string | null
  /** Monthly price in the display currency, or null for coming-soon cards. */
  price: number | null
  active: boolean
  /** False = can't be toggled (coming soon, or no longer a sellable add-on). */
  available: boolean
  details: string
  comingSoon: boolean
}

function formatPrice(symbol: string, amount: number, label: string) {
  return `${symbol}${amount}/mo · ${label}`
}

export function AddonsGrid({
  cards,
  currency,
}: {
  cards: AddonCard[]
  currency: CurrencyCode
}) {
  const meta = currencyMeta(currency)
  // Local active state so a toggle reflects instantly without a full reload.
  const [active, setActive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(cards.map((c) => [c.id, c.active])),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [learnMore, setLearnMore] = useState<AddonCard | null>(null)

  async function toggle(card: AddonCard) {
    if (!card.available || busy) return
    const next = !active[card.id]
    // Optimistic flip; revert on failure.
    setActive((prev) => ({ ...prev, [card.id]: next }))
    setBusy(card.id)
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: card.id, active: next }),
      })
      if (!res.ok) throw new Error('toggle failed')
    } catch {
      setActive((prev) => ({ ...prev, [card.id]: !next }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="mb-6 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
        Switch on the extras that fit your business. Changes apply to your
        subscription; you can turn anything off again any time.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const isOn = !!active[card.id]
          const img = addonPromoImage(card.id)
          const cost = card.comingSoon
            ? 'Coming soon'
            : card.price != null
              ? formatPrice(meta.symbol, card.price, meta.label)
              : 'Free'
          return (
            <div
              key={card.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Mini-promo header: name left, hero image bleeding in on the right
                  with a teal fade — mirrors the add-on promo modal. */}
              <div
                className="relative h-24 overflow-hidden text-white"
                style={{ backgroundImage: 'linear-gradient(135deg, #2A9DA9, #1F818C)' }}
              >
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.src}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{
                      objectPosition: img.objectPosition ?? 'center 45%',
                      transform: img.translateX ? `translateX(${img.translateX})` : undefined,
                    }}
                  />
                )}
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{ backgroundImage: 'linear-gradient(90deg, #1F818C 0%, #1F818C 42%, rgba(31,129,140,0) 100%)' }}
                />
                <div className="relative z-10 flex h-full w-[60%] flex-col justify-center px-4">
                  <h3 className="text-[15px] font-bold leading-tight">{card.name}</h3>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <p className="mb-3 text-sm leading-snug" style={{ color: 'var(--pm-ink-600, #475569)' }}>
                  {card.blurb}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
                      {cost}
                    </p>
                    <button
                      type="button"
                      onClick={() => setLearnMore(card)}
                      className="text-[13px] font-medium hover:underline"
                      style={{ color: 'var(--pm-brand-700)' }}
                    >
                      Learn more
                    </button>
                  </div>

                  <Switch
                    checked={isOn}
                    disabled={!card.available || busy === card.id}
                    busy={busy === card.id}
                    label={`Enable ${card.name}`}
                    onChange={() => toggle(card)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {learnMore && (
        <AddonPromoModal addonId={learnMore.id} currency={currency} onClose={() => setLearnMore(null)} />
      )}
    </>
  )
}

// Small accessible toggle in the house style (teal when on). No design-system
// Switch exists yet, so this is the canonical one for the add-ons surface.
function Switch({
  checked,
  disabled,
  busy,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  busy?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="relative inline-flex w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-brand-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      // height/minHeight inline: a global button-sizing rule (44px touch target)
      // out-specifies Tailwind's h-6, which would otherwise make this a circle.
      style={{ height: 24, minHeight: 0, backgroundColor: checked ? 'var(--pm-brand-600)' : 'var(--pm-ink-200, #cbd5e1)' }}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        } ${busy ? 'animate-pulse' : ''}`}
      />
    </button>
  )
}
