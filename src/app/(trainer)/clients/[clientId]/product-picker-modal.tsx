'use client'

import { useState } from 'react'
import { X, Plus, Check, Loader2, Tag, Package as PackageIcon, FileDown } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { effectivePriceCents, resolveVariantPricing } from '@/lib/product-price'
import type { ShopProduct } from './client-profile-types'

// The "add a product to this client" picker. Lifted out of the client profile
// when that screen lost its content cards — it now belongs to the Sessions
// page, with the "Bring to next session" list it fills.

export function ProductPickerModal({
  products,
  requestedIds,
  requestedVariantIds,
  onClose,
  onPick,
}: {
  products: ShopProduct[]
  requestedIds: Set<string>
  /** Options already on order for this client. */
  requestedVariantIds: Set<string>
  onClose: () => void
  onPick: (productId: string, variantId: string | null) => void | Promise<void>
}) {
  const currency = useCurrency()
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // A product with options OPENS instead of adding — the options appear
  // underneath it, in the same list. A second modal on top of this one to ask
  // "which size?" would be a sheet over a sheet, and the answer is three rows
  // long.
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = products.filter(p =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

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
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Add to next session</h2>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="px-5 py-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No products match.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(g => (
                <div key={g.category ?? '_'}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2 flex items-center gap-1.5">
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
                          className={`flex w-full items-center gap-3 px-2 py-2 -mx-2 rounded-xl text-left transition-colors ${
                            already ? 'opacity-60 cursor-default' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                            ) : p.kind === 'DIGITAL' ? (
                              <FileDown className="h-4 w-4 text-violet-500" />
                            ) : (
                              <PackageIcon className="h-4 w-4 text-amber-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                              <span className="truncate">{p.name}</span>
                              {!p.active && (
                                <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Hidden from the client's shop — you can still add it">
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
                            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1 flex-shrink-0">
                              <Check className="h-3.5 w-3.5" /> Added
                            </span>
                          ) : busyId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />
                          ) : variants.length > 0 ? (
                            <span className="text-xs text-slate-400 flex-shrink-0">{expanded ? 'Hide' : 'Choose'}</span>
                          ) : (
                            <Plus className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          )}
                        </button>

                        {expanded && (
                          <div className="ml-13 mb-1 overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-100">
                            {variants.map(v => {
                              const on = requestedVariantIds.has(v.id)
                              const cents = effectivePriceCents(resolveVariantPricing(p, v))
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => !on && pick(p.id, v.id)}
                                  disabled={on || busyId === v.id}
                                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                                    on ? 'opacity-60 cursor-default' : 'hover:bg-slate-50'
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
      </div>
    </div>
  )
}
