'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { CategoryRail, NONE, type RailCategory } from '../category-rail'

/**
 * The shelves, as a page. This is what /products' left rail becomes on a
 * phone, where there is no room for two columns.
 *
 * Picking one goes back to /products showing that shelf, rather than filtering
 * in place: the shelf you picked is the thing you came for, so the page you
 * end up on should be the products, not the list of categories you just used.
 */
export function CategoriesView({
  categories: initial,
  total,
  uncategorised,
}: {
  categories: RailCategory[]
  total: number
  uncategorised: number
}) {
  const router = useRouter()
  const [categories, setCategories] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  function open(id: string | null) {
    router.push(id == null ? '/products' : `/products?category=${encodeURIComponent(id)}`)
  }

  function reorder(ids: string[]) {
    const before = categories
    setCategories(ids.map(id => before.find(c => c.id === id)!).filter(Boolean))
    void (async () => {
      try {
        const res = await fetch('/api/products/categories/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        if (!res.ok) { setCategories(before); setError('Could not save that order.') }
      } catch {
        setCategories(before)
        setError('Could not save that order.')
      }
    })()
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      <CategoryRail
        categories={categories}
        total={total}
        uncategorised={uncategorised}
        selected={null}
        onSelect={id => open(id === NONE ? NONE : id)}
        onReorder={reorder}
        onCreated={c => { setCategories(prev => [...prev, c]); router.refresh() }}
        onError={setError}
        ownDragContext
      />
    </div>
  )
}
