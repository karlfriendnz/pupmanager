'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Star, Package as PackageIcon, FileDown, Download, ShoppingBag, X, Tag,
  Check, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Product {
  id: string
  name: string
  description: string | null
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  imageUrl: string | null
  downloadUrl: string | null
  category: string | null
  featured: boolean
  requested: boolean
}

function formatPrice(cents: number | null) {
  if (cents == null) return 'Contact trainer'
  return `$${(cents / 100).toFixed(2)}`
}

export function ShopGrid({ products }: { products: Product[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [open, setOpen] = useState<Product | null>(null)
  // Optimistic overrides for the requested flag — keys are product IDs.
  const [optimisticRequested, setOptimisticRequested] = useState<Record<string, boolean>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  function isRequested(p: Product) {
    return optimisticRequested[p.id] ?? p.requested
  }

  async function toggleRequest(p: Product) {
    if (busyId) return
    const next = !isRequested(p)
    setBusyId(p.id)
    setOptimisticRequested(prev => ({ ...prev, [p.id]: next }))
    try {
      const res = await fetch(`/api/my/products/${p.id}/request`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setOptimisticRequested(prev => ({ ...prev, [p.id]: !next }))
      } else {
        startTransition(() => router.refresh())
      }
    } catch {
      setOptimisticRequested(prev => ({ ...prev, [p.id]: !next }))
    } finally {
      setBusyId(null)
    }
  }

  const categories = useMemo(() => {
    return Array.from(new Set(products.map(p => p.category).filter(Boolean) as string[])).sort()
  }, [products])

  const visible = useMemo(() => {
    if (!activeCategory) return products
    return products.filter(p => p.category === activeCategory)
  }, [products, activeCategory])

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100 flex items-center justify-center">
          <ShoppingBag className="h-7 w-7 text-amber-600" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-600">Shop is opening soon</p>
        <p className="mt-1 text-xs text-slate-400 max-w-xs">
          Your trainer is curating products for you and your dog.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 lg:mx-0 lg:px-0 pb-1 no-scrollbar">
          <CategoryChip active={!activeCategory} onClick={() => setActiveCategory(null)}>
            All
          </CategoryChip>
          {categories.map(c => (
            <CategoryChip key={c} active={activeCategory === c} onClick={() => setActiveCategory(c)}>
              {c}
            </CategoryChip>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visible.map(p => (
          <button
            key={p.id}
            onClick={() => setOpen(p)}
            className="text-left rounded-2xl bg-white border border-slate-100 overflow-hidden hover:border-slate-200 hover:shadow-sm transition-all"
          >
            <div className="aspect-square bg-gradient-to-br from-amber-50 to-rose-50 relative flex items-center justify-center">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : p.kind === 'DIGITAL' ? (
                <FileDown className="h-7 w-7 text-violet-400" />
              ) : (
                <PackageIcon className="h-7 w-7 text-amber-400" />
              )}
              {p.featured && (
                <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-100 backdrop-blur px-2 py-0.5 rounded-full">
                  <Star className="h-3 w-3 fill-current" /> Featured
                </span>
              )}
              {isRequested(p) && (
                <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 backdrop-blur px-2 py-0.5 rounded-full">
                  <Check className="h-3 w-3" /> Requested
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-tight">{p.name}</p>
              <div className="mt-1">
                <span className="text-sm font-semibold text-slate-700">{formatPrice(p.priceCents)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Detail modal */}
      {open && (
        <ProductModal
          product={{ ...open, requested: isRequested(open) }}
          onClose={() => setOpen(null)}
          onToggleRequest={() => toggleRequest(open)}
          busy={busyId === open.id}
        />
      )}
    </div>
  )
}

function CategoryChip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
      )}
    >
      <Tag className="h-3 w-3" /> {children}
    </button>
  )
}

function ProductModal({
  product,
  onClose,
  onToggleRequest,
  busy,
}: {
  product: Product
  onClose: () => void
  onToggleRequest: () => void
  busy: boolean
}) {
  // Digital products can be downloaded immediately if a file is attached;
  // they don't need to be requested. Physical products use the request flow.
  const canDownload = product.kind === 'DIGITAL' && !!product.downloadUrl

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="aspect-square bg-gradient-to-br from-amber-50 to-rose-50 relative">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-5xl">
              {product.kind === 'DIGITAL' ? '📁' : '🛍️'}
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 h-9 w-9 rounded-full bg-white/90 backdrop-blur flex items-center justify-center text-slate-700 hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            {product.category && (
              <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">{product.category}</p>
            )}
            <h2 className="text-xl font-bold text-slate-900">{product.name}</h2>
            <p className="mt-1 text-lg font-semibold text-slate-700">{formatPrice(product.priceCents)}</p>
          </div>

          {product.description && (
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{product.description}</p>
          )}

          {canDownload ? (
            <a
              href={product.downloadUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          ) : product.requested ? (
            <button
              onClick={onToggleRequest}
              disabled={busy}
              className="w-full h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Check className="h-4 w-4" /> Requested · Tap to cancel</>
              }
            </button>
          ) : (
            <button
              onClick={onToggleRequest}
              disabled={busy}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><ShoppingBag className="h-4 w-4" /> Add to next session</>
              }
            </button>
          )}

          {!canDownload && (
            <p className="text-[11px] text-slate-400 text-center">
              Your trainer will bring this to your next session.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
