'use client'

import { useState } from 'react'
import { Layers, Pencil, Receipt } from 'lucide-react'
import { OfferingTabs, type OfferingTab } from '@/components/shared/offering-tabs'
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
  const tabs: OfferingTab<Tab>[] = [
    { id: 'details', label: 'Details', icon: Pencil },
    { id: 'options', label: 'Options', icon: Layers, badge: variants.length || undefined },
    { id: 'purchases', label: 'Purchases', icon: Receipt, badge: purchases.length },
  ]

  // The same pill strip the offering detail screens use — Karl pointed at that
  // screen ("here is an example") when he asked for this layout. It was a flat
  // underline row here, which is the LIST style; a detail screen you switch
  // views on is the other one, and there is no reason for products to be the
  // odd one out.
  const strip = <OfferingTabs tabs={tabs} value={tab} onChange={setTab} className="mb-0" />

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
          {strip}
          <ProductVariants
            productId={product.id}
            productName={product.name}
            productPriceCents={product.priceCents}
            productSalePriceCents={product.salePriceCents}
            // What a variant falls back to when it says nothing of its own.
            // Passed down so a blank photo/notes field can SHOW the product's
            // rather than sit empty and read as broken.
            productImageUrl={product.imageUrl}
            productDescription={product.description}
            initial={variants}
          />
        </>
      ) : (
        <>
          {strip}
          <ProductPurchases purchases={purchases} />
        </>
      )}
    </div>
  )
}
