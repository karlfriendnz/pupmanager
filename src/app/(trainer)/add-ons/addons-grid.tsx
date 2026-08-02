'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Where an ENABLED add-on's "Manage" action goes (a dedicated config page).
// Add-ons not listed just re-open their promo (which offers the on/off toggle).
const MANAGE_HREF: Record<string, string> = {
  xero: '/settings?tab=xero',
  payments: '/settings?tab=payments',
  instagram: '/instagram',
  // Google Calendar has no settings page — its card opens the promo popup, which
  // handles connect AND disconnect inline.
}
// Add-ons that ALWAYS route to their config page (never a toggle) — e.g.
// Payments, which is enabled by connecting Stripe, not flipping a switch.
const LINK_ONLY = new Set<string>(['payments'])
import { Button } from '@/components/ui/button'
import { apiErrorMessage } from '@/lib/api-error-message'
import { formatDate } from '@/lib/utils'
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

// What to show when a toggle fails. The generic "please try again" is now only
// reachable for a 4xx that carried no sentence at all — every real refusal from
// /api/addons names itself, and a 500 says so instead of promising a retry.
const addonError = (body: unknown, status: number) =>
  apiErrorMessage(body, status, {
    fallback: 'Could not change this add-on. Please try again.',
    unexplained:
      'Something went wrong changing this add-on and we don’t know what yet. Please contact support — we can see the details.',
  })

export function AddonsGrid({
  cards,
  currency,
  trialEndsAt = null,
}: {
  cards: AddonCard[]
  currency: CurrencyCode
  /**
   * ISO date the trainer's free trial ends, when they're still on it and have no
   * subscription yet. Non-null means a paid add-on switched on here costs nothing
   * until then and starts billing when they subscribe — which the card has to say
   * out loud before they tap it.
   */
  trialEndsAt?: string | null
}) {
  const meta = currencyMeta(currency)
  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null
  // Local active state so a toggle reflects instantly without a full reload.
  const [active, setActive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(cards.map((c) => [c.id, c.active])),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all')
  const router = useRouter()
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
        // Paid add-on with no subscription yet → send them to subscribe. NOT for
        // a subscription that Stripe can't find: sending them to /billing/setup
        // would offer a second subscription as the fix for a broken first one.
        if (body.needsSubscription && body.reason !== 'subscription_missing') {
          window.location.href = '/billing/setup'
          return
        }
        setError(addonError(body, res.status))
        return
      }
      setLearnMore(null) // success → close the popup
      // The card flips optimistically, but nav entries and every other
      // hasAddon-gated surface are server-rendered in the trainer layout —
      // without this they keep the old on/off state until a hard reload.
      router.refresh()
      // Just enabled an add-on that needs setup (connect Xero / Google) → take
      // them straight to its setup page.
      if (next && MANAGE_HREF[card.id]) { router.push(MANAGE_HREF[card.id]); return }
    } catch {
      // The request itself never landed (offline, aborted) — this IS the one
      // failure where trying again is the right advice.
      setActive((prev) => ({ ...prev, [card.id]: !next }))
      setError('We couldn’t reach PupManager just then. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  // Free vs paid filter. Free add-ons have no price; paid (incl. coming-soon)
  // carry one.
  const matchesFilter = (c: AddonCard) =>
    filter === 'all' || (filter === 'free' ? c.price == null : c.price != null)
  const enabled = cards.filter((c) => active[c.id] && matchesFilter(c))
  const availableCards = cards.filter((c) => !active[c.id] && matchesFilter(c))
  // What the switched-on PAID add-ons will add to the first invoice. Ignores the
  // free/paid filter deliberately — the number has to be the whole bill, not
  // whatever the current tab happens to show.
  const paidEnabledTotal = cards
    .filter((c) => active[c.id] && !c.comingSoon && c.price != null)
    .reduce((sum, c) => sum + (c.price ?? 0), 0)

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
        // A stable handle per add-on. Its accessible name is the whole card —
        // title, blurb and price — which collides with the nav item of the same
        // word for anything called "Marketing".
        data-testid={`addon-card-${card.id}`}
        onClick={() => {
          setError(null)
          // An enabled add-on with a config page → go manage it; otherwise the
          // promo (which carries the on/off toggle).
          const manageHref = MANAGE_HREF[card.id]
          if (manageHref && (LINK_ONLY.has(card.id) || active[card.id])) { router.push(manageHref); return }
          setLearnMore(card)
        }}
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
              {active[card.id] ? 'Manage' : LINK_ONLY.has(card.id) ? 'Set up' : 'Learn more'} →
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
          {/* A trainer on their trial can turn a paid add-on on with no card and
              no subscription. Say what that costs and WHEN, in one sentence, so
              nobody reads "turn it on now" as "it's free". */}
          {trialEnd && learnMore.price != null && (
            <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--pm-ink-600, #475569)' }}>
              {active[learnMore.id]
                ? `You're not paying for this yet. It's free until your trial ends on ${formatDate(trialEnd)}, then ${meta.symbol}${learnMore.price} a month once you subscribe.`
                : `Free for the rest of your trial. Your trial ends on ${formatDate(trialEnd)} — after that it's ${meta.symbol}${learnMore.price} a month.`}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      )
    : null

  return (
    <>
      {/* Free / paid filter */}
      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(['all', 'free', 'paid'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-lg px-4 h-9 text-sm font-medium capitalize transition-colors ${
              filter === f ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {enabled.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Your add-ons</h2>
          {/* One line, not a badge per card: what the paid ones will cost, and
              when. On trial they're switched on and charging nothing — the
              trainer should know that changes the day they subscribe. */}
          {trialEnd && paidEnabledTotal > 0 && (
            <p className="mb-3 text-sm" style={{ color: 'var(--pm-ink-700)' }}>
              You&apos;re on your free trial, so these cost nothing yet. When you subscribe, the paid
              ones add {meta.symbol}{paidEnabledTotal} a month. Turn any of them off here and you
              won&apos;t be charged for it.
            </p>
          )}
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
