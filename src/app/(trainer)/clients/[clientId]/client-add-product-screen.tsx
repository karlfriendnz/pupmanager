'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { EditScreen } from '@/components/shared/edit-screen'
import { ProductPickerList } from './product-picker-list'
import type { PendingProductRequest, ShopProduct } from './client-profile-types'

/**
 * "Add product" as a screen of its own (Karl, 2026-08-06: "should be a page").
 *
 * It was a bottom sheet. A page gets the search box a trainer with fifty
 * products needs, the shell's back arrow, and a foot that says how many they
 * have picked — and it keeps them on ONE surface rather than a list inside a
 * sheet inside a page.
 *
 * Picks are applied as they are made (the POST is per item, exactly as it was),
 * so "Done" is a navigation and not a save — there is nothing to lose by going
 * back. The count on the button is the feedback that something happened, since
 * the row it changes may have scrolled away.
 */
export function ClientAddProductScreen({
  clientId,
  products,
  pending: initialPending,
}: {
  clientId: string
  products: ShopProduct[]
  /** What is already set aside — the picker greys those rows out. */
  pending: PendingProductRequest[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(initialPending)
  const [added, setAdded] = useState(0)

  async function addProductRequest(productId: string, variantId: string | null) {
    const res = await fetch(`/api/clients/${clientId}/product-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, variantId }),
    })
    if (!res.ok) return
    const created = await res.json()
    const product = products.find(p => p.id === productId)
    if (!product) return
    const variant = product.variants?.find(v => v.id === variantId) ?? null
    setPending(prev => {
      if (prev.some(r => r.id === created.id)) return prev
      setAdded(n => n + 1)
      return [...prev, {
        id: created.id,
        note: created.note ?? null,
        variant: variant ? { id: variant.id, name: variant.name } : null,
        product: { id: product.id, name: product.name, kind: product.kind, imageUrl: product.imageUrl },
      }]
    })
  }

  return (
    <EditScreen
      primary={{
        label: added > 0 ? `Done · ${added} added` : 'Done',
        icon: <Check className="h-4 w-4" strokeWidth={1.75} />,
        // Not a Link: the list it returns to is server-rendered, so it needs a
        // refresh to show what was just added rather than a cached page.
        onClick: () => {
          router.push(`/clients/${clientId}/products`)
          router.refresh()
        },
      }}
    >
      <ProductPickerList
        products={products}
        // A varianted product is "added" per OPTION, so the two sets are
        // separate: the product row only greys out for things sold as one
        // thing. A client can have the Small and then also want the Large.
        requestedIds={new Set(pending.filter(r => !r.variant).map(r => r.product.id))}
        requestedVariantIds={new Set(pending.map(r => r.variant?.id).filter((id): id is string => !!id))}
        onPick={addProductRequest}
      />
    </EditScreen>
  )
}
