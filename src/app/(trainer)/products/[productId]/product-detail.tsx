'use client'

import { useState } from 'react'
import type { ProductCategoryOption } from '../product-form'
import { ProductForm, type ProductDraft } from '../product-form'
import { ProductPurchases, type Purchase } from './product-purchases'
import { ProductVariants, type VariantRow } from './product-variants'

type Tab = 'details' | 'options' | 'purchases'

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
  variants,
}: {
  product: ProductDraft
  existingCategories: ProductCategoryOption[]
  purchases: Purchase[]
  /** The sizes/colours this product comes in. Empty = sold as one thing. */
  variants: VariantRow[]
}) {
  const [tab, setTab] = useState<Tab>('details')

  // Options is a TAB, not a section of the details form: it is a list with its
  // own drag order and its own save, and hanging that off the bottom of a form
  // whose Save means something else is how two saves end up on one screen.
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'Details' },
    { id: 'options', label: 'Options', count: variants.length || undefined },
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
          variantCount={variants.length}
        />
      ) : tab === 'options' ? (
        <>
          <div className="flex items-end justify-between gap-3 border-b border-slate-200">{strip}</div>
          <ProductVariants
            productId={product.id}
            productName={product.name}
            productPriceCents={product.priceCents}
            productSalePriceCents={product.salePriceCents}
            initial={variants}
          />
        </>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 border-b border-slate-200">{strip}</div>
          <ProductPurchases purchases={purchases} />
        </>
      )}
    </div>
  )
}
