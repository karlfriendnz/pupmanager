'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { inStock, stockLabel } from '@/lib/stock'
import { RichText } from '@/components/shared/rich-text'
import { useRouter } from 'next/navigation'
import {
  Star, Package as PackageIcon, FileDown, Download, ShoppingBag, X, Tag,
  Check, Loader2, CreditCard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { effectivePriceCents } from '@/lib/product-price'
import { ProductPrice, SaleTag } from '@/components/shared/product-price'
import { useIsNative, nativePlatform } from '@/lib/native'
import { openExternal } from '@/lib/external-link'
import { PREVIEW_REASON, useIsPreview } from '../preview-context'

interface Product {
  id: string
  name: string
  description: string | null
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  /** Set = on sale. This, not priceCents, is what the client is charged. */
  salePriceCents: number | null
  stockCount: number | null
  imageUrl: string | null
  downloadUrl: string | null
  category: string | null
  featured: boolean
  requested: boolean
  purchased?: boolean
}

function formatPrice(cents: number | null, currency: string | null) {
  if (cents == null) return 'Contact trainer'
  return formatMoney(cents, currency ?? 'nzd')
}

export function ShopGrid({
  products,
  acceptPayments = false,
  currency = null,
}: {
  products: Product[]
  acceptPayments?: boolean
  currency?: string | null
}) {
  const router = useRouter()
  const native = useIsNative()
  const [, startTransition] = useTransition()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [open, setOpen] = useState<Product | null>(null)
  // Optimistic overrides for the requested flag — keys are product IDs.
  const [optimisticRequested, setOptimisticRequested] = useState<Record<string, boolean>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  // A trainer previewing cannot buy or request on their client's behalf — the
  // API refuses it, because both are real commitments on somebody else's
  // account. Read here so the buttons say so instead of failing on press.
  const isPreview = useIsPreview()
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)

  // A product is buyable when the trainer takes payments and it has a price —
  // the sale price when there is one, since that's what actually gets charged.
  function isPayable(p: Product) {
    const cents = effectivePriceCents(p)
    return acceptPayments && cents != null && cents > 0
  }

  async function buy(p: Product) {
    if (buyingId) return
    setBuyingId(p.id)
    setBuyError(null)
    try {
      const res = await fetch(`/api/my/products/${p.id}/buy`, {
        method: 'POST',
        headers: { 'x-pm-platform': nativePlatform() },
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        openExternal(body.url)
        return // leaving for Stripe — keep the spinner up
      }
      setBuyError(typeof body.error === 'string' ? body.error : 'Could not start checkout.')
    } catch {
      setBuyError('Could not start checkout.')
    } finally {
      setBuyingId(null)
    }
  }

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
          Products for you and your dog are on their way.
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
              <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1">
                <SaleTag product={p} />
                {p.featured && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-100 backdrop-blur px-2 py-0.5 rounded-full">
                    <Star className="h-3 w-3 fill-current" /> Featured
                  </span>
                )}
              </div>
              {isRequested(p) && (
                <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 backdrop-blur px-2 py-0.5 rounded-full">
                  <Check className="h-3 w-3" /> Requested
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-tight">{p.name}</p>
              <div className="mt-1">
                <ProductPrice product={p} currency={currency ?? 'nzd'} unpricedLabel="Contact trainer" />
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Detail modal */}
      {open && (
        <ProductModal
          product={{ ...open, requested: isRequested(open) }}
          currency={currency}
          payable={isPayable(open) && !isPreview}
          previewNote={isPreview ? PREVIEW_REASON : null}
          native={native}
          onClose={() => setOpen(null)}
          onToggleRequest={() => toggleRequest(open)}
          onBuy={() => buy(open)}
          busy={busyId === open.id}
          buying={buyingId === open.id}
          buyError={buyError}
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
  currency,
  payable,
  previewNote,
  native,
  onClose,
  onToggleRequest,
  onBuy,
  busy,
  buying,
  buyError,
}: {
  product: Product
  currency: string | null
  payable: boolean
  /** Set while a trainer previews — says why nothing here is live. */
  previewNote?: string | null
  native: boolean
  onClose: () => void
  onToggleRequest: () => void
  onBuy: () => void
  busy: boolean
  buying: boolean
  buyError: string | null
}) {
  // Digital downloads: free ones (no price / payments off) download immediately;
  // a PRICED digital product must be purchased first, then the download unlocks.
  const isPaidDigital = product.kind === 'DIGITAL' && payable
  const canDownload =
    product.kind === 'DIGITAL' && !!product.downloadUrl && (!isPaidDigital || !!product.purchased)
  // Apple Guideline 3.1.1: don't offer digital goods for purchase in the app.
  const digitalBlockedNative = isPaidDigital && !product.purchased && native

  // Lock the page behind the sheet. Without this the page scrolls underneath
  // it — two scrollbars on screen, which is a standing rule against.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    // Phone: a full screen, not a sheet — the product IS the screen, so there
    // is no value in a strip of blurred page above it. Desktop (sm+) keeps the
    // centred modal, where a dialog over the shop still reads correctly.
    <div className="fixed inset-0 z-50 bg-white sm:bg-slate-900/40 sm:backdrop-blur-sm flex sm:items-center justify-center p-0 sm:p-4">
      <div className="flex h-full w-full flex-col overflow-y-auto no-scrollbar bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-md sm:rounded-3xl">
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
            <ProductPrice
              product={product}
              currency={currency ?? 'nzd'}
              size="lg"
              unpricedLabel="Contact trainer"
              className="mt-1"
            />
            {stockLabel(product.stockCount) && (
              <p className={`mt-0.5 text-xs ${inStock(product.stockCount) ? 'text-slate-500' : 'text-slate-400'}`}>
                {stockLabel(product.stockCount)}
              </p>
            )}
          </div>

          <RichText html={product.description} className="text-sm text-slate-600" />

          {canDownload ? (
            <a
              href={product.downloadUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-12 rounded-xl bg-accent hover:opacity-90 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          ) : digitalBlockedNative ? (
            <div className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-center text-sm text-slate-500">
              This item can be bought on the web at app.pupmanager.com.
            </div>
          ) : !inStock(product.stockCount) ? (
            <div className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-center text-sm text-slate-500">
              Out of stock — ask when it&apos;s back.
            </div>
          ) : payable ? (
            <button
              onClick={onBuy}
              disabled={buying}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {buying
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><CreditCard className="h-4 w-4" /> Buy · {formatPrice(effectivePriceCents(product), currency)}</>
              }
            </button>
          ) : product.requested ? (
            <button
              onClick={onToggleRequest}
              disabled={busy || !!previewNote}
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
              disabled={busy || !!previewNote}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><ShoppingBag className="h-4 w-4" /> Add to next session</>
              }
            </button>
          )}

          {buyError && <p className="text-[11px] text-rose-600 text-center">{buyError}</p>}

          {/* Said UP FRONT, not after a press. The API refuses to buy or
              request in preview — it is a real charge on a real client's
              account — and a button that looks live until it fails is the
              worst of both. */}
          {previewNote && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800">
              {previewNote}
            </p>
          )}

          {!canDownload && !payable && !previewNote && (
            <p className="text-[11px] text-slate-400 text-center">
              You&apos;ll get this at your next session.
            </p>
          )}
          {payable && !digitalBlockedNative && (
            <p className="text-[11px] text-slate-400 text-center">
              Secure checkout via Stripe. You’ll get a receipt by email.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
