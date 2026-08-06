'use client'

import { useState } from 'react'
import { Plus, Loader2, Minus, Tag, Package as PackageIcon, FileDown } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { effectivePriceCents, resolveVariantPricing } from '@/lib/product-price'
import { MAX_PRODUCT_QUANTITY } from '@/lib/product-quantity'
import type { ShopProduct } from './client-profile-types'

/**
 * Pick something out of the trainer's shop for one client: a search box, the
 * catalogue grouped by tag, and a row per product that adds in one tap — or
 * opens into its options when it has them.
 *
 * This was the body of a bottom sheet. It is a PAGE now (Karl, 2026-08-06:
 * "should be a page") — `[section]/add/page.tsx` — so the markup lives here on
 * its own and the sheet has gone. Nothing else mounted it.
 *
 * A product with options OPENS instead of adding: the options appear
 * underneath it, in the same list. A second screen to ask "which size?" would
 * be a step for an answer that is three rows long, and the option is part of
 * what is being handed over — "a harness" is not something anyone can fetch.
 *
 * HOW MANY replaces the "Added" tick, on whichever row was added — the product
 * row for something sold as one thing, the OPTION row for something with sizes
 * (Karl: quantity belongs alongside the option choice, "not before the trainer
 * knows what they are buying"). Two consequences worth stating:
 *
 *   · The one-tap add survives. Tapping a row still sets one aside; the
 *     stepper only appears once there is an order for it to be about. A
 *     quantity box in front of every add would tax the common case (one of
 *     them) to serve the rare one.
 *   · The stepper is the ORDER's quantity, not a tally of taps. It goes down as
 *     well as up, because the fix for one tap too many should be a tap — and
 *     down puts the unit back on the shelf, which is why it is a route call
 *     rather than local state.
 */
export function ProductPickerList({
  products,
  requestedIds,
  requestedVariantIds,
  quantities,
  onPick,
  onQuantity,
}: {
  products: ShopProduct[]
  /** Products already set aside for this client, sold as one thing. */
  requestedIds: Set<string>
  /** Options already set aside. */
  requestedVariantIds: Set<string>
  /** How many are on the pending order, keyed by variant id — or product id for
   *  something sold as one thing. Absent means "not ordered". */
  quantities: Record<string, number>
  onPick: (productId: string, variantId: string | null) => void | Promise<void>
  /** Re-size the pending order. Null when the caller can't (nothing does today,
   *  but the picker shouldn't assume). */
  onQuantity: ((productId: string, variantId: string | null, quantity: number) => Promise<void>) | null
}) {
  const currency = useCurrency()
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = products.filter(p =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Grouped by tag — the same shape the /products grid uses.
  const groups: { category: string | null; items: ShopProduct[] }[] = []
  const seen = new Set<string | null>()
  for (const p of filtered) {
    const key = p.category ?? null
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ category: key, items: filtered.filter(x => (x.category ?? null) === key) })
    }
  }

  async function pick(id: string, variantId: string | null = null) {
    setBusyId(variantId ?? id)
    try { await onPick(id, variantId) }
    finally { setBusyId(null) }
  }

  async function step(productId: string, variantId: string | null, next: number) {
    if (!onQuantity) return
    setBusyId(variantId ?? productId)
    try { await onQuantity(productId, variantId, next) }
    finally { setBusyId(null) }
  }

  /**
   * The count on an added row, with a way to change it.
   *
   * Dropping to zero is not offered: it is a cancellation, and cancelling lives
   * on the products page (the X on the chip) where the trainer can see what
   * they are removing. Minus stops at one.
   */
  function Stepper({
    productId,
    variantId,
    quantity,
    busy,
    /** Product-row and option-row scales differ; nothing else does. */
    small = false,
  }: {
    productId: string
    variantId: string | null
    quantity: number
    busy: boolean
    small?: boolean
  }) {
    const box = small ? 'h-6 w-6' : 'h-7 w-7'
    const icon = small ? 'h-3 w-3' : 'h-3.5 w-3.5'
    const name = variantId ? 'this option' : 'this product'
    return (
      <span
        className="flex flex-shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1 py-0.5"
        // The row itself adds one on tap; the stepper must not do that too.
        onClick={e => { e.stopPropagation() }}
      >
        <button
          type="button"
          aria-label={`One fewer of ${name}`}
          disabled={busy || quantity <= 1 || !onQuantity}
          onClick={() => step(productId, variantId, quantity - 1)}
          className={`${box} flex items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100 disabled:opacity-40`}
        >
          <Minus className={icon} strokeWidth={1.75} />
        </button>
        {busy
          ? <Loader2 className={`${icon} animate-spin text-emerald-700`} />
          : (
            <span className="min-w-4 text-center text-xs font-semibold tabular-nums text-emerald-800">
              {quantity}
            </span>
          )}
        <button
          type="button"
          aria-label={`One more of ${name}`}
          disabled={busy || quantity >= MAX_PRODUCT_QUANTITY || !onQuantity}
          onClick={() => step(productId, variantId, quantity + 1)}
          className={`${box} flex items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100 disabled:opacity-40`}
        >
          <Plus className={icon} strokeWidth={1.75} />
        </button>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky under the shell's top bar, so a trainer with fifty products can
          keep typing while the list moves. */}
      <div className="sticky top-0 z-10 -mx-4 bg-[var(--surface,#f7fafb)] px-4 pb-2 pt-1 md:mx-0 md:px-0">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No products match.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(g => (
            <div key={g.category ?? '_'}>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                <Tag className="h-3 w-3" /> {g.category ?? 'Uncategorised'}
              </p>
              <div className="flex flex-col">
                {g.items.map(p => {
                  const variants = p.variants ?? []
                  const already = requestedIds.has(p.id)
                  const expanded = openId === p.id
                  // A product sold as one thing keys its count on its own id.
                  const qty = quantities[p.id] ?? 0
                  return (
                    <div key={p.id}>
                      {/* A row, not a button: the stepper lives inside it once
                          something has been added, and a button inside a button
                          is invalid markup that browsers resolve by dropping
                          one of them. The tappable area is its own button. */}
                      <div
                        className={`-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors ${
                          already ? '' : 'hover:bg-slate-50'
                        }`}
                      >
                        <button
                          onClick={() => {
                            if (already) return
                            if (variants.length > 0) { setOpenId(expanded ? null : p.id); return }
                            void pick(p.id)
                          }}
                          disabled={already || busyId === p.id}
                          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${already ? 'cursor-default opacity-60' : ''}`}
                        >
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                            ) : p.kind === 'DIGITAL' ? (
                              <FileDown className="h-4 w-4 text-violet-500" />
                            ) : (
                              <PackageIcon className="h-4 w-4 text-amber-600" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                              <span className="truncate">{p.name}</span>
                              {!p.active && (
                                <span className="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500" title="Hidden from the client's shop — you can still add it">
                                  Hidden
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {p.priceCents != null ? formatMoney(p.priceCents, currency) : 'Contact'}
                              {' · '}
                              {p.kind === 'DIGITAL' ? 'Digital' : 'Physical'}
                              {variants.length > 0 && ` · ${variants.length} options`}
                            </p>
                          </div>
                        </button>
                        {already ? (
                          // The count IS the confirmation — a tick beside a "2"
                          // would be saying it twice.
                          <Stepper
                            productId={p.id}
                            variantId={null}
                            quantity={Math.max(1, qty)}
                            busy={busyId === p.id}
                          />
                        ) : busyId === p.id ? (
                          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-slate-400" />
                        ) : variants.length > 0 ? (
                          <span className="flex-shrink-0 text-xs text-slate-400">{expanded ? 'Hide' : 'Choose'}</span>
                        ) : (
                          <Plus className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        )}
                      </div>

                      {expanded && (
                        <div className="ml-13 mb-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                          {variants.map(v => {
                            const on = requestedVariantIds.has(v.id)
                            const vQty = quantities[v.id] ?? 0
                            const cents = effectivePriceCents(resolveVariantPricing(p, v))
                            return (
                              // The option's own row, and where its quantity
                              // belongs: nobody can say how many until they
                              // have said which (Karl).
                              <div
                                key={v.id}
                                className={`flex w-full items-center gap-3 px-3 py-2 transition-colors ${on ? '' : 'hover:bg-slate-50'}`}
                              >
                                <button
                                  onClick={() => !on && pick(p.id, v.id)}
                                  disabled={on || busyId === v.id}
                                  className={`flex min-w-0 flex-1 items-center gap-3 text-left ${on ? 'cursor-default opacity-60' : ''}`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{v.name}</span>
                                  <span className="flex-shrink-0 text-xs tabular-nums text-slate-500">
                                    {cents != null ? formatMoney(cents, currency) : 'Contact'}
                                    {v.stockCount != null && ` · ${v.stockCount} left`}
                                  </span>
                                </button>
                                {on ? (
                                  <Stepper
                                    productId={p.id}
                                    variantId={v.id}
                                    quantity={Math.max(1, vQty)}
                                    busy={busyId === v.id}
                                    small
                                  />
                                ) : busyId === v.id ? (
                                  <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-400" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
