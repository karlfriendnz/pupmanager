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
 *
 * HOW MANY is applied the same way, as it is chosen, for the same reason: the
 * quantity is not a draft. It moves real stock and re-prices a real receivable,
 * so a stepper that only committed on "Done" would be a screenful of pending
 * effects that a back-swipe silently threw away. Every tap is a route call, and
 * the number on screen is what the database says.
 */
export function ClientAddProductScreen({
  clientId,
  products,
  pending: initialPending,
}: {
  clientId: string
  products: ShopProduct[]
  /** What is already set aside — the picker shows its count on those rows. */
  pending: PendingProductRequest[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(initialPending)
  const [added, setAdded] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function addProductRequest(productId: string, variantId: string | null) {
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/product-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, variantId }),
    })
    if (!res.ok) {
      // A short shelf comes back with a message that names the product and how
      // many are left. Swallowing it left the trainer tapping a row that did
      // nothing (AGENTS.md #9 — the state that changes what you can do belongs
      // where you make the choice).
      setError(await errorFrom(res))
      return
    }
    const created = await res.json()
    const product = products.find(p => p.id === productId)
    if (!product) return
    const variant = product.variants?.find(v => v.id === variantId) ?? null
    setAdded(n => n + 1)
    setPending(prev => {
      const at = prev.findIndex(r => r.id === created.id)
      // The route GROWS an order that already exists rather than creating a
      // second one, so the same id coming back is a quantity change, not a
      // duplicate to ignore.
      if (at !== -1) {
        const next = [...prev]
        next[at] = { ...next[at], quantity: created.quantity ?? next[at].quantity }
        return next
      }
      return [...prev, {
        id: created.id,
        note: created.note ?? null,
        quantity: created.quantity ?? 1,
        variant: variant ? { id: variant.id, name: variant.name } : null,
        product: { id: product.id, name: product.name, kind: product.kind, imageUrl: product.imageUrl },
      }]
    })
  }

  async function setQuantity(productId: string, variantId: string | null, quantity: number) {
    const row = pending.find(r =>
      r.product.id === productId && (r.variant?.id ?? null) === variantId,
    )
    if (!row) return
    setError(null)
    const res = await fetch(`/api/product-requests/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    })
    if (!res.ok) {
      setError(await errorFrom(res))
      return
    }
    const updated = await res.json()
    setPending(prev => prev.map(r =>
      r.id === row.id ? { ...r, quantity: updated.quantity ?? quantity } : r,
    ))
  }

  // How many things are set aside, counting the units — "3 added" for one
  // harness ordered three times, because three is what the trainer has to put
  // in the bag.
  const unitsAdded = added

  return (
    <EditScreen
      primary={{
        label: unitsAdded > 0 ? `Done · ${unitsAdded} added` : 'Done',
        icon: <Check className="h-4 w-4" strokeWidth={1.75} />,
        // Not a Link: the list it returns to is server-rendered, so it needs a
        // refresh to show what was just added rather than a cached page.
        onClick: () => {
          router.push(`/clients/${clientId}/products`)
          router.refresh()
        },
      }}
    >
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {error}
        </p>
      )}
      <ProductPickerList
        products={products}
        // A varianted product is "added" per OPTION, so the two sets are
        // separate: the product row only shows a count for things sold as one
        // thing. A client can have the Small and then also want the Large.
        requestedIds={new Set(pending.filter(r => !r.variant).map(r => r.product.id))}
        requestedVariantIds={new Set(pending.map(r => r.variant?.id).filter((id): id is string => !!id))}
        // Keyed on the VARIANT where there is one, so the Small's count and the
        // Large's are two numbers rather than one shared by the product.
        quantities={Object.fromEntries(
          pending.map(r => [r.variant?.id ?? r.product.id, r.quantity]),
        )}
        onPick={addProductRequest}
        onQuantity={setQuantity}
      />
    </EditScreen>
  )
}

/** The route's own message where there is one — never a raw status code. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch { /* not JSON */ }
  return 'That didn’t save. Try again.'
}
