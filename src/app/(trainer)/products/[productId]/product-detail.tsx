'use client'

import { useState } from 'react'
import { ProductForm, type ProductDraft } from '../product-form'
import { ProductPurchases, type Purchase } from './product-purchases'

type Tab = 'details' | 'purchases'

/**
 * A product, as a page: its details on one tab and who has it on the other.
 * The editor used to be a modal — a phone-sized sheet holding a dozen fields
 * and its own scrollbar, which is the shape AGENTS.md says takes a full screen.
 */
export function ProductDetail({
  product,
  existingCategories,
  purchases,
}: {
  product: ProductDraft
  existingCategories: string[]
  purchases: Purchase[]
}) {
  const [tab, setTab] = useState<Tab>('details')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'Details' },
    { id: 'purchases', label: 'Purchases', count: purchases.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Same pill track as the offering lists. Radii agree (track 16 = pill 10
          + 6 padding) so the active pill doesn't read as bulging out. */}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1.5 sm:inline-flex sm:self-start">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-sm font-medium transition-all duration-150 ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span
                className={`min-w-5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <ProductForm initial={product} isNew={false} existingCategories={existingCategories} />
      ) : (
        <ProductPurchases purchases={purchases} />
      )}
    </div>
  )
}
