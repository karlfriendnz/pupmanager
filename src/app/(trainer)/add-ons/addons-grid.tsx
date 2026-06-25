'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { currencyMeta, type CurrencyCode } from '@/lib/pricing'

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
          return (
            <div
              key={card.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <AddonImage id={card.id} name={card.name} />

              <div className="flex flex-1 flex-col p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
                    {card.name}
                  </h3>
                  {card.badge && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: card.comingSoon ? 'var(--pm-ink-100, #f1f5f9)' : 'var(--pm-accent-50, #ecfeff)',
                        color: card.comingSoon ? 'var(--pm-ink-500)' : 'var(--pm-accent-600, #0891b2)',
                      }}
                    >
                      {card.badge}
                    </span>
                  )}
                </div>

                <p className="mb-3 text-sm leading-snug" style={{ color: 'var(--pm-ink-600, #475569)' }}>
                  {card.blurb}
                </p>

                <div className="mt-auto">
                  <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
                    {card.price != null
                      ? formatPrice(meta.symbol, card.price, meta.label)
                      : 'Coming soon'}
                  </p>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setLearnMore(card)}
                      className="text-sm font-medium hover:underline"
                      style={{ color: 'var(--pm-brand-700)' }}
                    >
                      Learn more
                    </button>

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
            </div>
          )
        })}
      </div>

      {learnMore && (
        <Modal open onClose={() => setLearnMore(null)} title={learnMore.name}>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--pm-ink-700)' }}>
              {learnMore.details}
            </p>
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ backgroundColor: 'var(--pm-ink-50, #f8fafc)' }}
            >
              <span className="text-sm" style={{ color: 'var(--pm-ink-600, #475569)' }}>
                Cost
              </span>
              <span className="text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>
                {learnMore.price != null
                  ? formatPrice(meta.symbol, learnMore.price, meta.label)
                  : 'Coming soon'}
              </span>
            </div>
            {learnMore.available && (
              <Button
                variant={active[learnMore.id] ? 'secondary' : 'primary'}
                className="w-full"
                loading={busy === learnMore.id}
                onClick={() => toggle(learnMore)}
              >
                {active[learnMore.id] ? 'Turn off' : 'Turn on'}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

// Card image. Convention: /public/add-ons/<id>.png. Karl drops the real art
// there; until then we fall back to a tasteful branded placeholder so the grid
// never shows a broken image.
function AddonImage({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        className="flex aspect-[16/9] w-full items-center justify-center"
        style={{ background: 'linear-gradient(135deg, var(--pm-brand-50, #eef6f6), var(--pm-accent-50, #ecfeff))' }}
        aria-hidden
      >
        <Sparkles className="h-8 w-8" style={{ color: 'var(--pm-brand-400, #5e9c9c)' }} />
      </div>
    )
  }

  return (
    <div className="relative aspect-[16/9] w-full bg-slate-50">
      <Image
        src={`/add-ons/${id}.png`}
        alt={name}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </div>
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
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-brand-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: checked ? 'var(--pm-brand-600)' : 'var(--pm-ink-200, #cbd5e1)' }}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        } ${busy ? 'animate-pulse' : ''}`}
      />
    </button>
  )
}
