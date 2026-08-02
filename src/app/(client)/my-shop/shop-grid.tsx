'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { inStock, productInStock, stockLabel } from '@/lib/stock'
import { RichText } from '@/components/shared/rich-text'
import { useRouter } from 'next/navigation'
import {
  Star, Package as PackageIcon, FileDown, Download, ShoppingBag, X, Tag,
  Check, Loader2, CreditCard, EyeOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import {
  effectivePriceCents,
  productPriceSummary,
  resolveVariantPresentation,
  resolveVariantPricing,
} from '@/lib/product-price'
import { ProductPrice, SaleTag } from '@/components/shared/product-price'
import { useIsNative, nativePlatform } from '@/lib/native'
import { openExternal } from '@/lib/external-link'
import { PREVIEW_REASON, useIsPreview } from '../preview-context'

/** One thing a client can pick — "Large", "Red · Large". */
export interface Variant {
  id: string
  name: string
  /** Null on either = it costs what the product costs. */
  priceCents: number | null
  salePriceCents: number | null
  stockCount: number | null
  /** Null = the product's photo. Set when the Red one looks nothing like it. */
  imageUrl?: string | null
  /** Null/blank = the product's description. Tiptap HTML. */
  description?: string | null
}

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
  /**
   * The sizes/colours this comes in. Empty = sold as one thing, and every
   * screen below behaves exactly as it did before variants existed. With any,
   * one has to be picked before Buy or Request will do anything, because the
   * trainer would otherwise have no idea what to hand over.
   */
  variants?: Variant[]
  /**
   * Set ONLY for the hidden product a trainer opened via ?product= while
   * previewing. It is kept out of the grid and labelled in the sheet: a
   * preview that showed a client's shop with an unpublished product sitting in
   * it would be lying about the one thing it exists to answer.
   */
  hiddenFromShop?: boolean
}

function formatPrice(cents: number | null, currency: string | null) {
  if (cents == null) return 'Contact trainer'
  return formatMoney(cents, currency ?? 'nzd')
}

export function ShopGrid({
  products,
  acceptPayments = false,
  currency = null,
  openProductId = null,
}: {
  products: Product[]
  acceptPayments?: boolean
  currency?: string | null
  /** ?product= — the sheet this page was linked straight to. */
  openProductId?: string | null
}) {
  const router = useRouter()
  const native = useIsNative()
  const [, startTransition] = useTransition()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  // Deep link: the sheet is open on arrival when the URL named a product.
  // Initial state only, so closing it stays closed and an ordinary visit —
  // which is every visit without the param — behaves exactly as before.
  const [open, setOpen] = useState<Product | null>(
    () => products.find(p => p.id === openProductId) ?? null,
  )
  // Optimistic overrides for the requested flag — keys are product IDs.
  const [optimisticRequested, setOptimisticRequested] = useState<Record<string, boolean>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  // A trainer previewing cannot buy or request on their client's behalf — the
  // API refuses it, because both are real commitments on somebody else's
  // account. Read here so the buttons say so instead of failing on press.
  const isPreview = useIsPreview()
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)
  // Which option is picked in the open product. Cleared when the sheet closes,
  // so re-opening a product never buys last time's size by accident.
  const [pickedVariantId, setPickedVariantId] = useState<string | null>(null)

  // A product is buyable when the trainer takes payments and it has a price —
  // the sale price when there is one, since that's what actually gets charged.
  // With options, the cheapest one having a price is enough to show a Buy
  // button; the exact charge follows the option the client picks.
  function isPayable(p: Product) {
    const cents = productPriceSummary(p, p.variants ?? []).from
    return acceptPayments && cents != null && cents > 0
  }

  async function buy(p: Product, variantId: string | null) {
    if (buyingId) return
    setBuyingId(p.id)
    setBuyError(null)
    try {
      const res = await fetch(`/api/my/products/${p.id}/buy`, {
        method: 'POST',
        headers: { 'x-pm-platform': nativePlatform(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId }),
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

  async function toggleRequest(p: Product, variantId: string | null) {
    if (busyId) return
    const next = !isRequested(p)
    setBusyId(p.id)
    setOptimisticRequested(prev => ({ ...prev, [p.id]: next }))
    try {
      // The variant rides in the body on the way in and the query string on
      // the way out — cancelling the Large must leave a pending Small alone.
      const res = await fetch(
        next
          ? `/api/my/products/${p.id}/request`
          : `/api/my/products/${p.id}/request${variantId ? `?variantId=${encodeURIComponent(variantId)}` : ''}`,
        next
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ variantId }),
            }
          : { method: 'DELETE' },
      )
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

  // The shop proper. A hidden product handed in for preview is deliberately
  // NOT part of it — the grid, the chips and the "opening soon" empty state all
  // have to answer "what does my client see", and it is not one of the things
  // they see. It exists on this screen only as something the sheet can open.
  const catalog = useMemo(() => products.filter(p => !p.hiddenFromShop), [products])

  const categories = useMemo(() => {
    return Array.from(new Set(catalog.map(p => p.category).filter(Boolean) as string[])).sort()
  }, [catalog])

  const visible = useMemo(() => {
    if (!activeCategory) return catalog
    return catalog.filter(p => p.category === activeCategory)
  }, [catalog, activeCategory])

  // Closing a deep-linked sheet drops the param, so a refresh or a Back doesn't
  // reopen the thing the trainer just dismissed.
  function close() {
    setOpen(null)
    setPickedVariantId(null)
    if (openProductId) startTransition(() => router.replace('/my-shop', { scroll: false }))
  }

  // Empty shop, but keep rendering: in preview the sheet may be the only thing
  // on this screen, and returning early here would show the trainer an "opening
  // soon" page with nothing on it instead of the product they clicked Preview on.
  const shopIsEmpty = catalog.length === 0

  return (
    <div className="flex flex-col gap-5">
      {shopIsEmpty && (
        <div className="flex flex-col items-center justify-center text-center py-12">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100 flex items-center justify-center">
            <ShoppingBag className="h-7 w-7 text-amber-600" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-600">Shop is opening soon</p>
          <p className="mt-1 text-xs text-slate-400 max-w-xs">
            Products for you and your dog are on their way.
          </p>
        </div>
      )}

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
      {!shopIsEmpty && (
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
                <CardPrice product={p} currency={currency ?? 'nzd'} />
              </div>
            </div>
          </button>
        ))}
      </div>
      )}

      {/* Detail modal */}
      {open && (
        <ProductModal
          product={{ ...open, requested: isRequested(open) }}
          currency={currency}
          payable={isPayable(open) && !isPreview}
          previewNote={isPreview ? PREVIEW_REASON : null}
          native={native}
          pickedVariantId={pickedVariantId}
          onPickVariant={setPickedVariantId}
          onClose={close}
          onToggleRequest={() => toggleRequest(open, pickedVariantId)}
          onBuy={() => buy(open, pickedVariantId)}
          busy={busyId === open.id}
          buying={buyingId === open.id}
          buyError={buyError}
        />
      )}
    </div>
  )
}

/**
 * The price on a shop card.
 *
 * A product with options has a RANGE, and printing one number off the product
 * row would be a price nobody can actually pay — "from $24" is the honest
 * version. With no options this is the same single price it has always been.
 */
function CardPrice({ product, currency }: { product: Product; currency: string }) {
  const summary = productPriceSummary(product, product.variants ?? [])
  if (summary.count === 0) {
    return <ProductPrice product={product} currency={currency} unpricedLabel="Contact trainer" />
  }
  if (summary.from == null) {
    return <span className="text-sm font-semibold text-slate-500">Contact trainer</span>
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {summary.varies && <span className="text-xs text-slate-400">from</span>}
      <span className="text-sm font-semibold text-slate-900">{formatMoney(summary.from, currency)}</span>
      <span className="text-[11px] text-slate-400">{summary.count} options</span>
    </span>
  )
}

/**
 * Pick a size / colour.
 *
 * ONE bordered block split by hairlines, not a row of chips or a dropdown —
 * the house list, and the only shape that has room for a name, a price and a
 * "only 2 left" on a 390px screen. A dropdown would also hide exactly the
 * thing being chosen between: which options are actually left.
 *
 * A sold-out option stays VISIBLE and disabled. Removing it would leave the
 * client wondering whether the Large exists at all; saying "Out of stock"
 * answers the question they came with.
 */
function VariantPicker({
  product,
  variants,
  currency,
  pickedId,
  onPick,
}: {
  product: Product
  variants: Variant[]
  currency: string
  pickedId: string | null
  onPick: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Choose one</p>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-200">
        {variants.map(v => {
          const available = inStock(v.stockCount)
          const cents = effectivePriceCents(resolveVariantPricing(product, v))
          const chosen = v.id === pickedId
          return (
            <button
              key={v.id}
              type="button"
              disabled={!available}
              onClick={() => onPick(v.id)}
              aria-pressed={chosen}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                chosen ? 'bg-slate-50' : 'active:bg-slate-50',
                !available && 'opacity-50',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{v.name}</span>
                {(!available || stockLabel(v.stockCount)) && (
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {available ? stockLabel(v.stockCount) : 'Out of stock'}
                  </span>
                )}
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {cents == null ? '—' : formatMoney(cents, currency)}
                </span>
                {chosen && <Check className="h-4 w-4 text-slate-900" strokeWidth={2.25} />}
              </span>
            </button>
          )
        })}
      </div>
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
  pickedVariantId,
  onPickVariant,
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
  /** Which option is chosen. Null until they pick, and always null with none. */
  pickedVariantId: string | null
  onPickVariant: (id: string | null) => void
  onClose: () => void
  onToggleRequest: () => void
  onBuy: () => void
  busy: boolean
  buying: boolean
  buyError: string | null
}) {
  const variants = product.variants ?? []
  const picked = variants.find(v => v.id === pickedVariantId) ?? null
  // A product with options can't be acted on until one is chosen. The buttons
  // stay visible and say so, rather than failing on press — the same reasoning
  // the preview note below is written for.
  const mustPick = variants.length > 0 && !picked
  // What is actually being bought: the picked option's price, inheriting the
  // product's where it has none. One helper, so this can never disagree with
  // what the server charges.
  const pricing = resolveVariantPricing(product, picked)
  // And what is actually being LOOKED at. Same rule, same helper: the picked
  // option's photo and words when it has them, the product's when it doesn't —
  // which is the case for nearly every option, so nothing on this screen
  // changes until a trainer deliberately gives one its own. Picking the Red
  // collar and still seeing the blue photo is the bug this closes.
  const shown = resolveVariantPresentation(product, picked)
  // The count that decides "out of stock" — the picked option's once there are
  // options at all, otherwise the product's own, unchanged.
  const available = picked
    ? inStock(picked.stockCount)
    : productInStock(product, variants)

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
          {shown.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown.imageUrl}
              // Named, because once the picture can change under the choice the
              // alt has to say WHICH one is on screen.
              alt={picked ? `${product.name} — ${picked.name}` : product.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
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
            {/* The whole reason a trainer previews an unfinished product is to
                see it before anyone else can. Say so on the screen, or this
                reads as though it is already on sale. */}
            {product.hiddenFromShop && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                <EyeOff className="h-3 w-3" strokeWidth={1.75} />
                Hidden — no client can see this yet
              </p>
            )}
            <ProductPrice
              product={pricing}
              currency={currency ?? 'nzd'}
              size="lg"
              unpricedLabel="Contact trainer"
              className="mt-1"
            />
            {/* The stock line follows the same rule as the price: the picked
                option's count once one is picked, the product's when there are
                no options at all, and nothing while a choice is outstanding —
                "Only 2 left" of an unnamed something means nothing. */}
            {picked ? (
              stockLabel(picked.stockCount) && (
                <p className={`mt-0.5 text-xs ${inStock(picked.stockCount) ? 'text-slate-500' : 'text-slate-400'}`}>
                  {stockLabel(picked.stockCount)}
                </p>
              )
            ) : variants.length === 0 && stockLabel(product.stockCount) ? (
              <p className={`mt-0.5 text-xs ${inStock(product.stockCount) ? 'text-slate-500' : 'text-slate-400'}`}>
                {stockLabel(product.stockCount)}
              </p>
            ) : null}
          </div>

          {/* Through <RichText>, always — it sanitizes before it renders, and a
              variant description is trainer-authored HTML shown to a client. */}
          <RichText html={shown.description} className="text-sm text-slate-600" />

          {variants.length > 0 && (
            <VariantPicker
              product={product}
              variants={variants}
              currency={currency ?? 'nzd'}
              pickedId={pickedVariantId}
              onPick={onPickVariant}
            />
          )}

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
          ) : !available ? (
            <div className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-center text-sm text-slate-500">
              Out of stock — ask when it&apos;s back.
            </div>
          ) : payable ? (
            <button
              onClick={onBuy}
              disabled={buying || mustPick}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {buying
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : mustPick
                  ? 'Choose an option'
                  : <><CreditCard className="h-4 w-4" /> Buy · {formatPrice(effectivePriceCents(pricing), currency)}</>
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
              disabled={busy || !!previewNote || mustPick}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : mustPick
                  ? 'Choose an option'
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
