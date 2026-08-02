'use client'

import { useState } from 'react'
import type { ProductCategoryOption } from '../product-form'
import { ProductForm, type ProductDraft } from '../product-form'
import { ProductPurchases, type Purchase } from './product-purchases'

type Tab = 'details' | 'purchases'

/**
 * A product, as a page: its details on one tab and who has it on the other.
 * The editor used to be a modal — a phone-sized sheet holding a dozen fields
 * and its own scrollbar, which is the shape AGENTS.md says takes a full screen.
 *
 * The tabs and the form's own actions share ONE row, on one hairline — the same
 * shape the offering lists use. It was a pill track with a separate white
 * action bar floating under it: two bands of chrome stacked above the first
 * field, saying nothing to each other.
 */
export function ProductDetail({
  product,
  existingCategories,
  purchases,
}: {
  product: ProductDraft
  existingCategories: ProductCategoryOption[]
  purchases: Purchase[]
}) {
  const [tab, setTab] = useState<Tab>('details')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'Details' },
    { id: 'purchases', label: 'Purchases', count: purchases.length },
  ]

  // Flat underline tabs, not a pill track: the house style has no chip
  // controls, and this is what every offering list already does.
  const strip = (
    <div className="flex gap-5">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          aria-pressed={tab === t.id}
          className={`-mb-px shrink-0 border-b-2 py-2 text-sm font-medium transition-colors ${
            tab === t.id
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          {t.count != null && (
            <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {tab === 'details' ? (
        <ProductForm
          initial={product}
          isNew={false}
          existingCategories={existingCategories}
          heading={strip}
        />
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 border-b border-slate-200">{strip}</div>
          <ProductPurchases purchases={purchases} />
        </>
      )}
    </div>
  )
}
