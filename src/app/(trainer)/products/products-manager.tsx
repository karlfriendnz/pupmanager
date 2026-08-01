'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Star, Tag, Package as PackageIcon, FileDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AddOfferingButton } from '@/components/shared/offering-card'
import { useCurrency } from '@/components/currency-context'
import { ProductPrice, SaleTag } from '@/components/shared/product-price'
import { stockLabel, inStock } from '@/lib/stock'

type Kind = 'PHYSICAL' | 'DIGITAL'

export interface Product {
  id: string
  name: string
  description: string | null
  kind: Kind
  priceCents: number | null
  salePriceCents: number | null
  stockCount: number | null
  imageUrl: string | null
  downloadUrl: string | null
  category: string | null
  featured: boolean
  active: boolean
  xeroAccountCode: string | null
  requirePayment: boolean | null
}

/**
 * The products list. Tapping a product opens its own page (details + who has
 * bought it) rather than a modal — a dozen fields in a sheet with its own
 * scrollbar is exactly the shape AGENTS.md says takes the whole screen.
 */
export function ProductsManager({ initialProducts }: { initialProducts: Product[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>()
    for (const p of initialProducts) {
      const key = p.category ?? 'Uncategorised'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1
      if (b === 'Uncategorised') return -1
      return a.localeCompare(b)
    })
  }, [initialProducts])

  if (initialProducts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
        <PackageIcon className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
        <p className="mt-3 text-sm font-medium text-slate-600">No products yet</p>
        <p className="mt-1 text-xs text-slate-400">
          Add your first product to start selling to your clients.
        </p>
        <Link
          href="/products/new"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 active:bg-slate-50"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} /> Add product
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The action, at the top and to the right — same place as every other
          list in the app. A dashed row under the last card reads as an empty
          slot, and it walks further down the page the more products you have. */}
      <div className="flex justify-end">
        <AddOfferingButton href="/products/new" label="Add product" />
      </div>

      {grouped.map(([cat, items]) => (
        <div key={cat} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <Tag className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-slate-700">{cat}</h2>
            <span className="text-xs text-slate-400">{items.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      ))}

    </div>
  )
}

function ProductCard({ product }: { product: Product }) {
  const currency = useCurrency()
  const stock = stockLabel(product.stockCount)

  return (
    <Link
      href={`/products/${product.id}`}
      className={cn(
        'block overflow-hidden rounded-xl border border-slate-200 bg-white text-left active:bg-slate-50',
        !product.active && 'opacity-60'
      )}
    >
      <div className="relative flex aspect-video items-center justify-center bg-slate-50">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : product.kind === 'DIGITAL' ? (
          <FileDown className="h-7 w-7 text-slate-400" strokeWidth={1.75} />
        ) : (
          <PackageIcon className="h-7 w-7 text-slate-400" strokeWidth={1.75} />
        )}

        <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
          <SaleTag product={product} />
          {product.featured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur">
              <Star className="h-3 w-3" strokeWidth={1.75} /> Featured
            </span>
          )}
        </div>
        {!product.active && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-700 backdrop-blur">
            Hidden
          </span>
        )}
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name}</p>
          <ProductPrice product={product} currency={currency} className="flex-shrink-0 justify-end" />
        </div>
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {product.kind === 'DIGITAL' ? 'Digital' : 'Physical'}
          {stock && (
            <span className={inStock(product.stockCount) ? 'text-slate-400' : 'text-red-500'}> · {stock}</span>
          )}
        </p>
      </div>
    </Link>
  )
}
