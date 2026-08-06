'use client'

import { useState } from 'react'
import { Plus, Check, Loader2, Tag, Package as PackageIcon, FileDown } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { effectivePriceCents, resolveVariantPricing } from '@/lib/product-price'
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
 */
export function ProductPickerList({
  products,
  requestedIds,
  requestedVariantIds,
  onPick,
}: {
  products: ShopProduct[]
  /** Products already set aside for this client, sold as one thing. */
  requestedIds: Set<string>
  /** Options already set aside. */
  requestedVariantIds: Set<string>
  onPick: (productId: string, variantId: string | null) => void | Promise<void>
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
                  return (
                    <div key={p.id}>
                      <button
                        onClick={() => {
                          if (already) return
                          if (variants.length > 0) { setOpenId(expanded ? null : p.id); return }
                          void pick(p.id)
                        }}
                        disabled={already || busyId === p.id}
                        className={`-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                          already ? 'cursor-default opacity-60' : 'hover:bg-slate-50'
                        }`}
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
                        {already ? (
                          <span className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
                            <Check className="h-3.5 w-3.5" /> Added
                          </span>
                        ) : busyId === p.id ? (
                          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-slate-400" />
                        ) : variants.length > 0 ? (
                          <span className="flex-shrink-0 text-xs text-slate-400">{expanded ? 'Hide' : 'Choose'}</span>
                        ) : (
                          <Plus className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        )}
                      </button>

                      {expanded && (
                        <div className="ml-13 mb-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                          {variants.map(v => {
                            const on = requestedVariantIds.has(v.id)
                            const cents = effectivePriceCents(resolveVariantPricing(p, v))
                            return (
                              <button
                                key={v.id}
                                onClick={() => !on && pick(p.id, v.id)}
                                disabled={on || busyId === v.id}
                                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                                  on ? 'cursor-default opacity-60' : 'hover:bg-slate-50'
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{v.name}</span>
                                <span className="flex-shrink-0 text-xs tabular-nums text-slate-500">
                                  {cents != null ? formatMoney(cents, currency) : 'Contact'}
                                  {v.stockCount != null && ` · ${v.stockCount} left`}
                                </span>
                                {on ? (
                                  <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                                ) : busyId === v.id ? (
                                  <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-400" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                                )}
                              </button>
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
