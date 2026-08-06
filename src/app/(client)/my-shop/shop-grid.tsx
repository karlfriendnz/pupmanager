'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { inStock, productInStock, stockLabel } from '@/lib/stock'
import { RichText } from '@/components/shared/rich-text'
import { useRouter } from 'next/navigation'
import {
  Star, Package as PackageIcon, FileDown, Download, ShoppingBag, X, Tag,
  Check, Loader2, CreditCard, EyeOff, ChevronRight, Minus, Plus,
} from 'lucide-react'
import type { ShopTag } from '@/lib/shop-tags'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import {
  effectivePriceCents,
  isPaidDigitalProduct,
  productPriceSummary,
  resolveVariantPresentation,
  resolveVariantPricing,
} from '@/lib/product-price'
import { ProductPrice, SaleTag } from '@/components/shared/product-price'
import { useIsNative, nativePlatform } from '@/lib/native'
import { openExternal } from '@/lib/external-link'
import { PREVIEW_REASON, useIsPreview } from '../preview-context'
import { useBasketOptional } from '../basket/basket-context'
import type { BasketProductLine } from '@/lib/basket'
import { MAX_PRODUCT_QUANTITY } from '@/lib/product-quantity'

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
  /** How many are on order, summed across options. 0 when nothing is. */
  requestedQuantity?: number
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

/**
 * The shop's own URL, with whichever of its two states are on.
 *
 * Both live in the query string and neither may clobber the other: closing a
 * product must not drop the tag the client is browsing, and arriving on a
 * ?product= deep link must not invent a tag. One builder, so that stays true.
 */
function shopHref(tagId: string | null, productId: string | null) {
  const q = new URLSearchParams()
  if (tagId) q.set('tag', tagId)
  if (productId) q.set('product', productId)
  const s = q.toString()
  return s ? `/my-shop?${s}` : '/my-shop'
}

export function ShopGrid({
  products,
  acceptPayments = false,
  currency = null,
  openProductId = null,
  tags = [],
  activeTag = null,
  offeringsTitle = 'Offerings',
}: {
  products: Product[]
  acceptPayments?: boolean
  currency?: string | null
  /** ?product= — the sheet this page was linked straight to. */
  openProductId?: string | null
  /**
   * The trainer's tags that have something in THIS shop. Already emptied of
   * the ones that don't by listShopTags, so every row here goes somewhere.
   */
  tags?: ShopTag[]
  /** ?tag= — resolved server-side. `products` is already narrowed to it. */
  activeTag?: ShopTag | null
  /** The trainer's word for the screen classes and sessions are booked on. */
  offeringsTitle?: string
}) {
  const router = useRouter()
  const native = useIsNative()
  const [, startTransition] = useTransition()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  // The full-screen tag list. A screen rather than a dropdown because a trainer
  // may have twenty tags and because picking one changes what the whole page is
  // — see TagChooser.
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
  // Optional: the provider is mounted on the client layout, but this grid also
  // renders inside the trainer's PREVIEW of the shop, where there is no basket
  // to add to. Optional rather than required keeps that path from throwing.
  const basket = useBasketOptional()
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)
  // Which option is picked in the open product. Cleared when the sheet closes,
  // so re-opening a product never buys last time's size by accident.
  const [pickedVariantId, setPickedVariantId] = useState<string | null>(null)
  // How many. Same lifetime as the picked option, and for the same reason:
  // re-opening a product must never carry over "3" from the last one.
  const [quantity, setQuantity] = useState(1)

  // A product is buyable when the trainer takes payments and it has a price —
  // the sale price when there is one, since that's what actually gets charged.
  // With options, the cheapest one having a price is enough to show a Buy
  // button; the exact charge follows the option the client picks.
  function isPayable(p: Product) {
    const cents = productPriceSummary(p, p.variants ?? []).from
    return acceptPayments && cents != null && cents > 0
  }

  async function buy(p: Product, variantId: string | null, qty: number) {
    if (buyingId) return
    setBuyingId(p.id)
    setBuyError(null)
    try {
      const res = await fetch(`/api/my/products/${p.id}/buy`, {
        method: 'POST',
        headers: { 'x-pm-platform': nativePlatform(), 'Content-Type': 'application/json' },
        // The number is the client's; the PRICE is never sent. The route
        // re-reads what a unit costs and multiplies it itself, so a tampered
        // basket can only ever produce a refusal.
        body: JSON.stringify({ variantId, quantity: qty }),
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

  async function toggleRequest(p: Product, variantId: string | null, qty: number) {
    if (busyId) return
    const next = !isRequested(p)
    setBusyId(p.id)
    setBuyError(null)
    setOptimisticRequested(prev => ({ ...prev, [p.id]: next }))
    try {
      // The variant rides in the body on the way in and the query string on
      // the way out — cancelling the Large must leave a pending Small alone.
      // Cancelling carries no quantity: it ends the order, all of it, and the
      // route puts back however many the row says (never a hard-coded one).
      const res = await fetch(
        next
          ? `/api/my/products/${p.id}/request`
          : `/api/my/products/${p.id}/request${variantId ? `?variantId=${encodeURIComponent(variantId)}` : ''}`,
        next
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ variantId, quantity: qty }),
            }
          : { method: 'DELETE' },
      )
      if (!res.ok) {
        setOptimisticRequested(prev => ({ ...prev, [p.id]: !next }))
        // A short shelf comes back naming how many are left. Swallowing it left
        // the client tapping a button that did nothing.
        const body = await res.json().catch(() => ({}))
        setBuyError(typeof body?.error === 'string' ? body.error : 'That didn’t go through.')
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

  // The shelf actually in force. Derived rather than reset in an effect: moving
  // into a tag re-renders this component with a smaller catalogue, and a chip
  // for "Treats" that the tag has none of would otherwise stay lit over an
  // empty grid. A shelf that isn't on this screen simply isn't selected.
  const shelf = activeCategory && categories.includes(activeCategory) ? activeCategory : null

  const visible = useMemo(() => {
    if (!shelf) return catalog
    return catalog.filter(p => p.category === shelf)
  }, [catalog, shelf])

  // Closing a deep-linked sheet drops the param, so a refresh or a Back doesn't
  // reopen the thing the trainer just dismissed — but keeps the tag, which is
  // where the client still is.
  function close() {
    setOpen(null)
    setPickedVariantId(null)
    setQuantity(1)
    if (openProductId) {
      startTransition(() => router.replace(shopHref(activeTag?.id ?? null, null), { scroll: false }))
    }
  }

  // Empty shop, but keep rendering: in preview the sheet may be the only thing
  // on this screen, and returning early here would show the trainer an "opening
  // soon" page with nothing on it instead of the product they clicked Preview on.
  const shopIsEmpty = catalog.length === 0

  // Add rather than buy. Someone getting a harness is very often getting the
  // class too, and sending them to Stripe on the first tap is what made that
  // two payments and two trips.
  function addToBasket(p: Product, variantId: string | null, qty: number) {
    const variant = (p.variants ?? []).find(v => v.id === variantId) ?? null
    const cents = effectivePriceCents(resolveVariantPricing(p, variant))
    if (!basket || !cents || cents <= 0) return
    const shown = resolveVariantPresentation(p, variant)
    basket.add({
      kind: 'PRODUCT',
      productId: p.id,
      variantId,
      // The number chosen in the sheet. The basket ACCUMULATES product lines,
      // so adding two and then three is five — and the basket's own stepper
      // still adjusts it afterwards.
      quantity: qty,
      name: p.name,
      variantName: variant?.name ?? null,
      imageUrl: shown.imageUrl,
      unitAmount: cents,
    } satisfies BasketProductLine)
    // Straight back to the shop — "continue shopping" is the whole point.
    setOpen(null)
    setPickedVariantId(null)
    setQuantity(1)
  }

  return (
    <div className="flex flex-col gap-5">
      {shopIsEmpty && (
        activeTag ? (
          // Under a tag the honest answer is about the tag, not the shop. "Shop
          // is opening soon" over a shop that plainly has things in it — the
          // client was just looking at them — reads as a fault.
          <div className="flex flex-col items-center justify-center text-center py-10">
            <p className="text-sm font-medium text-slate-600">
              Nothing in the shop under {activeTag.name} right now
            </p>
            <Link
              href={shopHref(null, null)}
              className="mt-3 inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
            >
              Show the whole shop
            </Link>
          </div>
        ) : (
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
      )}

      {/* Categories and tags, one rail. A tag used to be a card of its own
          above the shelves, opening a chooser — which made a theme feel like a
          different kind of thing from a shelf when, to someone shopping, it is
          just another way to narrow what is on screen (Karl, 2026-08-06: "it
          should simply look like another category").

          They stay different underneath: a shelf is local state, a tag is in
          the URL (it is shared with the booking screen and is linkable), so a
          tag chip is a Link and a shelf chip is a button. */}
      {(categories.length > 0 || tags.length > 0) && (
        <div className="flex gap-2 overflow-x-auto -mx-5 px-5 lg:mx-0 lg:px-0 pb-1 no-scrollbar">
          {activeTag ? (
            <Link
              href={shopHref(null, null)}
              className="flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-slate-200 text-slate-600"
            >
              All
            </Link>
          ) : (
            <CategoryChip active={!shelf} onClick={() => setActiveCategory(null)}>
              All
            </CategoryChip>
          )}
          {categories.map(c => (
            <CategoryChip key={c} active={!activeTag && shelf === c} onClick={() => setActiveCategory(c)}>
              {c}
            </CategoryChip>
          ))}
          {tags.map(t => {
            const on = activeTag?.id === t.id
            return (
              <Link
                key={t.id}
                href={on ? shopHref(null, null) : shopHref(t.id, null)}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  on
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <Tag className="h-3 w-3" strokeWidth={1.75} />
                {t.name}
              </Link>
            )
          })}
        </div>
      )}

      {/* The half of the tag that isn't for sale. It lived inside the old card;
          without it a client filtering by "Puppy" would never learn the same
          theme is on the classes too. */}
      {activeTag?.alsoBookable && (
        <Link href="/my-availability" className="flex items-center gap-2 text-xs text-slate-600">
          <span className="min-w-0 truncate">{activeTag.name} is on {offeringsTitle.toLowerCase()} too</span>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-accent" strokeWidth={1.75} />
        </Link>
      )}


      {/* Grid */}
      {!shopIsEmpty && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visible.map(p => {
          // Sold out has to be visible from the SHELF. It was only ever said
          // inside the sheet, so a client picked the thing they wanted, tapped
          // it, and only then found out it was gone (audit C-5).
          const soldOut = !productInStock(p, p.variants ?? [])
          return (
          <button
            key={p.id}
            onClick={() => setOpen(p)}
            className="text-left rounded-2xl bg-white border border-slate-100 overflow-hidden hover:border-slate-200 hover:shadow-sm transition-all"
          >
            <div className="aspect-square bg-gradient-to-br from-amber-50 to-rose-50 relative flex items-center justify-center">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover',
                    soldOut && 'opacity-40',
                  )}
                />
              ) : p.kind === 'DIGITAL' ? (
                <FileDown className={cn('h-7 w-7 text-violet-400', soldOut && 'opacity-40')} />
              ) : (
                <PackageIcon className={cn('h-7 w-7 text-amber-400', soldOut && 'opacity-40')} />
              )}
              <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1">
                <SaleTag product={p} />
                {p.featured && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-100 backdrop-blur px-2 py-0.5 rounded-full">
                    <Star className="h-3 w-3 fill-current" /> Featured
                  </span>
                )}
              </div>
              {soldOut ? (
                <span className="absolute top-2 right-2 text-[10px] font-bold text-slate-600 bg-white/90 backdrop-blur px-2 py-0.5 rounded-full">
                  Sold out
                </span>
              ) : isRequested(p) && (
                <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 backdrop-blur px-2 py-0.5 rounded-full">
                  {/* "Requested" is a poorer answer than "Requested × 3" when
                      three are coming, and the card is where a client checks. */}
                  <Check className="h-3 w-3" /> Requested
                  {(p.requestedQuantity ?? 0) > 1 && ` × ${p.requestedQuantity}`}
                </span>
              )}
            </div>
            <div className="p-3">
              <p className={cn(
                'text-sm font-semibold line-clamp-2 leading-tight',
                soldOut ? 'text-slate-500' : 'text-slate-900',
              )}>{p.name}</p>
              <div className="mt-1">
                {/* The price stays on a sold-out card — it's still what the
                    thing costs, and "when's it back?" is the next question.
                    The chip above says sold out; saying it twice is noise. */}
                <CardPrice product={p} currency={currency ?? 'nzd'} />
              </div>
            </div>
          </button>
          )
        })}
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
          quantity={quantity}
          onQuantity={setQuantity}
          onClose={close}
          onToggleRequest={() => toggleRequest(open, pickedVariantId, quantity)}
          onBuy={() => buy(open, pickedVariantId, quantity)}
          onAddToBasket={basket && isPayable(open) && !isPreview ? () => addToBasket(open, pickedVariantId, quantity) : null}
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
        'flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
      )}
    >
      {children}
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
  quantity,
  onQuantity,
  onClose,
  onToggleRequest,
  onBuy,
  onAddToBasket,
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
  /** How many, feeding whichever of the three actions is taken. */
  quantity: number
  onQuantity: (n: number) => void
  onClose: () => void
  onToggleRequest: () => void
  onBuy: () => void
  /** Null when there is no basket to add to — a trainer previewing, or an
   *  unpriced item. Secondary to Buy: buying one thing now is still the
   *  common case, and the basket is the "…and the class too" case. */
  onAddToBasket: (() => void) | null
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
  const unitCents = effectivePriceCents(pricing)
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

  // The most they can ask for: whichever is smaller of what's on the shelf and
  // the app-wide ceiling. An UNCOUNTED product (null) has no shelf to run out
  // of, so it is capped by the ceiling alone.
  const shelfCount = picked ? picked.stockCount : (variants.length === 0 ? product.stockCount : null)
  const maxQuantity = shelfCount == null
    ? MAX_PRODUCT_QUANTITY
    : Math.max(1, Math.min(MAX_PRODUCT_QUANTITY, shelfCount))

  // Digital downloads: a free one downloads immediately; a PRICED one must be
  // bought first. Priced is priced — whether this trainer can take cards
  // decides HOW they pay, never whether they have to (audit C-8).
  const isPaidDigital = isPaidDigitalProduct(product, variants)
  // The server has already withheld downloadUrl from anyone who hasn't earned
  // it, so this is the button's rule, not the paywall.
  const canDownload =
    product.kind === 'DIGITAL' && !!product.downloadUrl && (!isPaidDigital || !!product.purchased)
  // Apple Guideline 3.1.1: don't offer digital goods for purchase in the app.
  // Tied to `payable`, because it's the card checkout Apple objects to — a
  // trainer who can't take cards isn't selling anything in here to block.
  const digitalBlockedNative = isPaidDigital && payable && !product.purchased && native

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

          {/* HOW MANY, under the options and above the action — Karl: "when
              ordering a product i should be able to say I want 2 of these".
              It sits below the option picker because nobody can say how many
              until they have said WHICH, and a product with options greys it
              out until one is chosen.

              ONE control for all three actions (Buy, Add to basket, Add to next
              session). Two steppers, one per button, would be two answers to
              one question.

              A digital download has no quantity: buying the same PDF twice is
              not a thing anyone wants, and neither is a shelf count for it.

              Nor does a CANCEL. When the only action left is "tap to cancel",
              a "How many" above it is asking a question the button cannot
              answer — cancelling ends the whole order, and the route puts back
              however many the row says. */}
          {!canDownload && !isPaidDigital && available && !previewNote
            && (payable || !product.requested) && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm font-medium text-slate-700">How many</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="One fewer"
                  disabled={quantity <= 1 || mustPick}
                  onClick={() => onQuantity(quantity - 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-700 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <span className="min-w-7 text-center text-sm font-semibold tabular-nums text-slate-900">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One more"
                  // Capped by the SHELF as well as the ceiling, so the client
                  // can't ask for five of a thing there are two of and only
                  // find out after tapping (AGENTS.md #9 — the state that
                  // changes what you can do belongs where you choose).
                  disabled={quantity >= maxQuantity || mustPick}
                  onClick={() => onQuantity(quantity + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-700 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </span>
            </div>
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
            <>
            <button
              onClick={onBuy}
              disabled={buying || mustPick}
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {buying
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : mustPick
                  ? 'Choose an option'
                  // The TOTAL, not the unit price. "Buy · $20" on a basket of
                  // three is the wrong number in the one place a client is
                  // about to commit to it.
                  : <><CreditCard className="h-4 w-4" /> Buy · {formatPrice(unitCents == null ? null : unitCents * quantity, currency)}</>
              }
            </button>
            {/* Under Buy, not instead of it. Buying the one thing you came for
                stays the one-tap path; the basket is the "and the class too"
                case. */}
            {onAddToBasket && (
              <button
                onClick={onAddToBasket}
                disabled={mustPick}
                className="mt-2 w-full h-12 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold flex items-center justify-center gap-2 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <ShoppingBag className="h-4 w-4" strokeWidth={1.75} /> Add to basket
              </button>
            )}
            </>
          ) : product.requested ? (
            <button
              onClick={onToggleRequest}
              disabled={busy || !!previewNote}
              className="w-full h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : (
                  <>
                    <Check className="h-4 w-4" />
                    {/* The count, so "tap to cancel" says what is being
                        cancelled — three of them, not one. */}
                    Requested{(product.requestedQuantity ?? 0) > 1 ? ` × ${product.requestedQuantity}` : ''} · Tap to cancel
                  </>
                )
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
              {isPaidDigital
                ? 'Your trainer will unlock this download once you’ve paid.'
                : 'You’ll get this at your next session.'}
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
