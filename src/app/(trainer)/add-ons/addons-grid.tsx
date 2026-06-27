'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
  const [error, setError] = useState<string | null>(null)

  async function toggle(card: AddonCard) {
    if (!card.available || busy) return
    const next = !active[card.id]
    // Optimistic flip; revert on failure.
    setActive((prev) => ({ ...prev, [card.id]: next }))
    setBusy(card.id)
    setError(null)
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: card.id, active: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActive((prev) => ({ ...prev, [card.id]: !next })) // revert
        // Paid add-on with no subscription yet → send them to subscribe.
        if (body.needsSubscription) { window.location.href = '/billing/setup'; return }
        setError(typeof body.error === 'string' ? body.error : 'Could not change this add-on. Please try again.')
        return
      }
      setLearnMore(null) // success → close the popup
    } catch {
      setActive((prev) => ({ ...prev, [card.id]: !next }))
      setError('Could not change this add-on. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const enabled = cards.filter((c) => active[c.id])
  const availableCards = cards.filter((c) => !active[c.id])

  function renderCard(card: AddonCard) {
    const img = addonPromoImage(card.id)
    const cost = card.comingSoon
      ? 'Coming soon'
      : card.price != null
        ? formatPrice(meta.symbol, card.price, meta.label)
        : 'Free'
    return (
      <button
        key={card.id}
        type="button"
        onClick={() => { setError(null); setLearnMore(card) }}
        className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
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
            <p className="text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>{cost}</p>
            <span className="text-[13px] font-medium group-hover:underline" style={{ color: 'var(--pm-brand-700)' }}>
              {active[card.id] ? 'Manage' : 'Learn more'} →
            </span>
          </div>
        </div>
      </button>
    )
  }

  // The popup's CTA toggles the add-on (and closes), so enable/disable happens
  // through the promo — not an inline switch.
  const learnCta = learnMore
    ? learnMore.comingSoon
      ? <div className="w-full"><Button size="lg" className="w-full" disabled>Coming soon</Button></div>
      : (
        <div className="w-full">
          <Button
            size="lg"
            className="w-full"
            loading={busy === learnMore.id}
            disabled={!learnMore.available}
            onClick={() => toggle(learnMore)}
          >
            {active[learnMore.id] ? `Turn off ${learnMore.name}` : `Turn on ${learnMore.name}`}
          </Button>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      )
    : null

  return (
    <>
      {enabled.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Your add-ons</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{enabled.map(renderCard)}</div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {enabled.length > 0 ? 'Available add-ons' : 'Add-ons'}
        </h2>
        <p className="mb-4 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
          Switch on the extras that fit your business — turn anything off again any time.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{availableCards.map(renderCard)}</div>
      </section>

      {learnMore && (
        <AddonPromoModal addonId={learnMore.id} currency={currency} cta={learnCta} onClose={() => setLearnMore(null)} />
      )}
    </>
  )
}
