'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { XeroAccountField } from '@/components/shared/xero-account-field'
import { SectionLabel } from '@/components/shared/flat-list'
import { TagPicker, saveTags } from '@/components/shared/tag-picker'
import { isRichTextEmpty } from '@/lib/rich-text'
import { SetPageImmersive } from '@/components/shared/page-title'
import { compressImageFile } from '@/lib/compress-image'
import { readApiError } from '@/lib/api-error'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol, formatMoney } from '@/lib/money'
import { savingPercent, validateSalePrice } from '@/lib/product-price'
import { cn } from '@/lib/utils'
import { Copy, Eye, EyeOff, ImagePlus, Loader2, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { StockSheet } from './stock-sheet'

export type Kind = 'PHYSICAL' | 'DIGITAL'

/** Sentinel for the select's "+ New category…" row. */
const NEW_CATEGORY = '__new__'

/** A real category row, which is what the shelves on /products are. */
export interface ProductCategoryOption { id: string; name: string }

export interface ProductDraft {
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
  categoryId: string | null
  featured: boolean
  active: boolean
  xeroAccountCode: string | null
  requirePayment: boolean | null
}

export const EMPTY_PRODUCT: ProductDraft = {
  id: '',
  name: '',
  description: null,
  kind: 'PHYSICAL',
  priceCents: null,
  salePriceCents: null,
  stockCount: null,
  imageUrl: null,
  downloadUrl: null,
  category: null,
  categoryId: null,
  featured: false,
  active: true,
  xeroAccountCode: null,
  requirePayment: null,
}

/** cents → the string the money inputs hold. */
function toInput(cents: number | null) {
  return cents != null ? (cents / 100).toFixed(2) : ''
}

/** the string the money inputs hold → cents, or undefined when unreadable. */
function toCents(value: string): number | null | undefined {
  if (value.trim() === '') return null
  const n = Math.round(parseFloat(value) * 100)
  return Number.isNaN(n) || n < 0 ? undefined : n
}

/**
 * The whole product form, as a page — one column at 390px, wider gutters when
 * there's room. Used by both /products/new and /products/[id].
 */
export function ProductForm({
  initial,
  isNew,
  existingCategories,
  heading,
  variantCount = 0,
}: {
  initial: ProductDraft
  isNew: boolean
  existingCategories: ProductCategoryOption[]
  /** The page's tab strip. Given one, it shares the actions' row and hairline. */
  heading?: React.ReactNode
  /**
   * How many options this product has. Above zero the counts live on THEM, so
   * this form must not offer a number that nothing reads — it points at the
   * Options tab instead.
   */
  variantCount?: number
}) {
  const router = useRouter()
  const currency = useCurrency()
  const symbol = currencySymbol(currency)

  const [draft, setDraft] = useState<ProductDraft>(initial)
  const [priceInput, setPriceInput] = useState(toInput(initial.priceCents))
  const [saleInput, setSaleInput] = useState(toInput(initial.salePriceCents))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // '' is Uncategorised; this sentinel opens the "type a new name" field. A
  // real category can never be called it — it is not a name a select shows.
  const [addingCategory, setAddingCategory] = useState(false)
  // Tags live in their own join table, not on the product row, so they are held
  // here and written after the save — a new product has no id to hang them off
  // until the create comes back.
  const [tagIds, setTagIds] = useState<string[]>([])
  const [stockOpen, setStockOpen] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [uploadingDownload, setUploadingDownload] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const downloadInputRef = useRef<HTMLInputElement>(null)

  function update<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  // Live sale preview — the same rule the server enforces, so the trainer never
  // finds out on save.
  // The draft stores the category by NAME (that is what the API resolves), so
  // the select's value is whichever known row matches it. No match and a name
  // present means it was typed — the new-category field is showing.
  const matchedCategory = draft.category
    ? existingCategories.find(c => c.name.toLowerCase() === draft.category!.trim().toLowerCase())
    : undefined
  // Show the name field when the trainer asked for a new one — OR when this
  // product already carries a category that is not one of the rows. Plenty of
  // products were filed by free text before the shelves existed, and dropping
  // that name into a select it isn't in would silently read "Uncategorised"
  // while the value was still there.
  const typingCategory = addingCategory || (!!draft.category?.trim() && !matchedCategory)

  const parsedPrice = toCents(priceInput)
  const parsedSale = toCents(saleInput)
  const salePreview =
    typeof parsedPrice === 'number' && typeof parsedSale === 'number'
      ? validateSalePrice(parsedPrice, parsedSale) ??
        `Clients pay ${formatMoney(parsedSale, currency)} instead of ${formatMoney(parsedPrice, currency)} — ${savingPercent({ priceCents: parsedPrice, salePriceCents: parsedSale })}% off.`
      : parsedSale === null && saleInput.trim() === ''
        ? null
        : validateSalePrice(parsedPrice ?? null, parsedSale ?? null)
  const salePreviewIsError = !!salePreview && !salePreview.startsWith('Clients pay')

  async function uploadImage(file: File) {
    setError(null)
    setUploadingImg(true)
    try {
      // Compressed client-side: the server upload route sits behind Vercel's
      // 4.5MB body cap, and a phone photo blows straight past it.
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'product')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Upload failed')); return }
      update('imageUrl', body.url)
    } finally {
      setUploadingImg(false)
    }
  }

  async function uploadDownload(file: File) {
    setError(null)
    setUploadingDownload(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'product')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Upload failed')); return }
      update('downloadUrl', body.url)
    } finally {
      setUploadingDownload(false)
    }
  }

  /**
   * The typed word → the category row it means, creating one if it is new.
   *
   * The field stays a combobox because "type a new one" is how this form has
   * always worked, but the shelves on /products are rows now, so a name on its
   * own is not enough — a product filed under a word nothing points at would
   * simply never show up on a shelf. Matching is case-insensitive so "treats"
   * and "Treats" don't become two shelves saying the same thing.
   */
  async function resolveCategoryId(): Promise<string | null> {
    const name = draft.category?.trim()
    if (!name) return null
    const known = existingCategories.find(c => c.name.toLowerCase() === name.toLowerCase())
    if (known) return known.id
    const res = await fetch('/api/products/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({}))
    // A category that won't save shouldn't stop the product saving — the
    // product lands in Uncategorised and can be dragged onto a shelf.
    return res.ok && typeof body.id === 'string' ? body.id : null
  }

  async function save() {
    setError(null)

    if (parsedPrice === undefined) { setError('Price must be a positive number'); return }
    if (parsedSale === undefined) { setError('Sale price must be a positive number'); return }
    const priceProblem = validateSalePrice(parsedPrice, parsedSale)
    if (priceProblem) { setError(priceProblem); return }

    setSaving(true)
    const payload = {
      name: draft.name,
      description: draft.description,
      kind: draft.kind,
      priceCents: parsedPrice,
      salePriceCents: parsedSale,
      // Only on create. On an existing product the ledger owns the count, and
      // sending the value this page loaded with would quietly undo whatever
      // the Add stock sheet recorded while the form sat open.
      ...(isNew ? { stockCount: draft.stockCount ?? null } : {}),
      imageUrl: draft.imageUrl,
      downloadUrl: draft.downloadUrl,
      category: draft.category,
      categoryId: await resolveCategoryId(),
      featured: draft.featured,
      active: draft.active,
      xeroAccountCode: draft.xeroAccountCode,
      requirePayment: draft.requirePayment,
    }

    try {
      const res = await fetch(isNew ? '/api/products' : `/api/products/${draft.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body)); return }
      // After the product exists, never as part of it — see saveTags. A tag
      // that didn't stick is a chip to re-tap; a failed product save is worse.
      await saveTags({ productId: isNew ? body.id : draft.id }, tagIds)
      router.push(isNew ? `/products/${body.id}` : '/products')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft.id) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${draft.id}`, { method: 'DELETE' })
      if (!res.ok) { setError('Delete failed'); return }
      router.push('/products')
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Filling in a form is one job. The bottom tabs and the global "+" both
          offer to start something ELSE mid-sentence, and the + floats over the
          last field (Karl, 2026-08-06: "these should not be there its
          confusing"). The shell already knows how to stand down — this is the
          same switch an open message thread uses. */}
      <SetPageImmersive value />
      {/* Save leads the form rather than sitting at the foot of it, and shares
          the tab strip's row and hairline — one band of chrome above the first
          field, not two stacked ones. It STICKS, which is what the pinned
          bottom bar was really buying (it is always reachable) without a bar
          that has to dodge the desktop sidebar and the phone's safe area. */}
      {/* On a phone the tabs and the actions cannot share one row: the tabs are
          as wide as their words and the actions got pushed off the edge, so
          "Cancel" was clipped mid-word. Actions take their own row above, and
          the tabs scroll sideways under them. From md: up there is room for the
          original single band. */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-1 border-b border-slate-200 bg-slate-50/95 px-4 pb-1.5 pt-1 backdrop-blur md:mx-0 md:flex-row md:items-end md:justify-between md:gap-3 md:px-0">
        <div className="order-2 min-w-0 overflow-x-auto no-scrollbar md:order-1">{heading ?? <span />}</div>
        <span className="order-1 flex flex-shrink-0 items-center justify-end gap-2 md:order-2 md:pb-1">
        {/* See it the way a client does. A plain <a>, not router.push: the
            target is a route handler that has to set the preview cookie on its
            own redirect, which the client router would swallow.

            Only on a saved product — a preview renders what is IN the database,
            so offering it beside an unsaved draft would show the trainer the
            old version of the thing they are looking at. */}
        {!isNew && (
          <a
            href={`/products/${draft.id}/preview`}
            // A NEW TAB, deliberately. Preview renders what is SAVED, so
            // navigating away from a form with unsaved edits would throw them
            // out to look at a version that does not include them — losing work
            // to go and see the wrong thing. A tab also lets the trainer keep
            // editing on one side and re-read the client's view on the other.
            target="_blank"
            rel="noopener noreferrer"
            title="Opens your shop in a new tab, as one of your clients sees it. Shows what's saved."
            className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
          >
            <Eye className="h-4 w-4" strokeWidth={1.75} />
            Preview
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={() => router.push('/products')}>Cancel</Button>
        <Button size="sm" loading={saving} onClick={save} disabled={!draft.name.trim()}>
          {isNew ? 'Create product' : 'Save changes'}
        </Button>
        {/* Nothing to duplicate or delete until it exists. */}
        {!isNew && (
          <ProductActions
            productId={draft.id}
            name={draft.name}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
        </span>
      </div>

      {stockOpen && (
        <StockSheet
          productId={draft.id}
          productName={draft.name}
          stockCount={draft.stockCount}
          onClose={() => setStockOpen(false)}
          onChanged={next => update('stockCount', next)}
        />
      )}

      {confirmDelete && (
        <ConfirmSheet
          title={`Delete “${draft.name}”?`}
          body="It comes off your shop for good. Anything a client has already bought keeps its record."
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}

      {/* ── What it looks like ─────────────────────────────────────────────
          The picture sits to the RIGHT of the words, at the size a client will
          actually see it, rather than as a 24×20 thumbnail above them. It is
          the first thing anyone judges a product by, so it gets shown at a size
          you can judge. Below `lg` it stacks back on top — a phone has one
          column and the photo leads. */}
      <section>
        <SectionLabel>Listing</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="order-2 rounded-xl border border-slate-200 bg-white lg:order-1">
          <div className="p-4">
            <Input
              label="Name"
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              placeholder="Long line · 5m"
            />
          </div>

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <RichTextEditor
              value={draft.description ?? ''}
              onChange={html => update('description', isRichTextEmpty(html) ? null : html)}
              minHeight={120}
              theme="light"
            />
          </div>

          {/* Stock sits with the listing, under the description. It is a fact
              ABOUT this item like its name and its words are — a section of its
              own for one number put a heading and a card around it.

              On a product that EXISTS the count is TEXT, not a field. Typing 9
              over 12 recorded nothing about the three that went, so the number
              was the only thing anyone could ever know. It changes through Add
              stock now, which asks what happened and keeps the history. A
              product being created has no history to keep and nowhere to put
              it, so /products/new still takes an opening count directly. */}
          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            {variantCount > 0 ? (
              // The counts live on the options once there are any — a harness
              // in S/M/L is three shelves. Showing a fourth number here that
              // nothing reads is worse than showing none.
              <>
                <p className="text-sm font-medium text-slate-700">Units on hand</p>
                <p className="text-sm text-slate-500">
                  Counted per option now — {variantCount} of them. Open the
                  Options tab to add stock.
                </p>
              </>
            ) : isNew ? (
              <>
                <label htmlFor="product-stock" className="text-sm font-medium text-slate-700">Units on hand</label>
                <input
                  id="product-stock"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={draft.stockCount ?? ''}
                  onChange={e => update('stockCount', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))}
                  placeholder="Leave blank if you don't count this"
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500">
                  Counts down as items go out. At zero it stops being sellable until you add more.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">Units on hand</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                      {draft.stockCount ?? <span className="text-base font-normal text-slate-500">Not counted</span>}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStockOpen(true)}>
                    {draft.stockCount === null ? 'Start counting' : 'Add stock'}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Counts down as items go out. At zero it stops being sellable until you add more.
                </p>
              </>
            )}
          </div>

          {/* A real <select>, not a <datalist>.
              The datalist looked like a dropdown — it even drew a caret — but a
              datalist only ever offers TYPE-AHEAD: the caret opens nothing on
              several browsers, the suggestion list renders detached from the
              field, and it cannot be styled. Categories are real rows now (the
              shelves on /products), so picking one is a choice from a list, and
              typing a new one is the exception that asks for a field. */}
          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label htmlFor="product-category" className="text-sm font-medium text-slate-700">Category</label>
            <select
              id="product-category"
              value={typingCategory ? NEW_CATEGORY : (matchedCategory?.name ?? '')}
              onChange={e => {
                if (e.target.value === NEW_CATEGORY) { setAddingCategory(true); update('category', null); return }
                setAddingCategory(false)
                update('category', e.target.value || null)
              }}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Uncategorised</option>
              {existingCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              <option value={NEW_CATEGORY}>+ New category…</option>
            </select>
            {typingCategory && (
              <input
                autoFocus
                value={draft.category ?? ''}
                onChange={e => update('category', e.target.value || null)}
                placeholder="Name the new category"
                aria-label="New category name"
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            <p className="text-xs text-slate-500">
              {typingCategory
                ? 'It is created when you save, and appears as a shelf on your shop.'
                : 'Which shelf this sits on in your shop.'}
            </p>
          </div>

          {/* Under Category on purpose, and separate from it. A category is a
              shelf in THIS shop; a tag reaches out of the shop and gathers this
              product up with the class and the 1:1 session it goes with. */}
          <div className="border-t border-slate-200 p-4">
            <TagPicker
              value={tagIds}
              onChange={setTagIds}
              loadFor={isNew ? undefined : { productId: draft.id }}
            />
          </div>
          </div>

          <div className="order-1 rounded-xl border border-slate-200 bg-white p-4 lg:order-2">
            <p className="text-sm font-medium text-slate-700">Photo</p>
            <div className="mt-2 aspect-4/3 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {draft.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-slate-400" strokeWidth={1.75} />
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => imgInputRef.current?.click()} disabled={uploadingImg}>
                {uploadingImg
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                  : draft.imageUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {draft.imageUrl && (
                <button type="button" onClick={() => update('imageUrl', null)} className="px-2 text-xs text-slate-400 hover:text-red-500">
                  Remove
                </button>
              )}
            </div>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }}
            />
          </div>
        </div>
      </section>

      {/* ── Price ──────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Price</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          {/* The two prices sit SIDE BY SIDE. A sale price only means anything
              against the normal one — reading them stacked, with a divider
              between, made you scroll to compare the two numbers the sentence
              below is about. */}
          <div className="p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="product-price" className="text-sm font-medium text-slate-700">Normal price</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-400">{symbol}</span>
                  <input
                    id="product-price"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="Leave blank for “Contact”"
                    value={priceInput}
                    onChange={e => setPriceInput(e.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="product-sale-price" className="text-sm font-medium text-slate-700">Sale price</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-400">{symbol}</span>
                  <input
                    id="product-sale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="Not on sale"
                    value={saleInput}
                    onChange={e => setSaleInput(e.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {saleInput.trim() !== '' && (
                    <button
                      type="button"
                      onClick={() => setSaleInput('')}
                      className="flex-shrink-0 text-xs text-slate-400 hover:text-red-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className={cn('mt-2 text-xs', salePreviewIsError ? 'text-red-600' : 'text-slate-500')}>
              {salePreview ?? 'Set a sale price and clients are charged it instead — the normal price shows struck through.'}
            </p>
          </div>

          {/* Which account the money lands in — a question about this price,
              so it sits with it rather than three sections further down. */}
          <div className="border-t border-slate-200 p-4">
            <XeroAccountField
              value={draft.xeroAccountCode ?? ''}
              onChange={v => update('xeroAccountCode', v || null)}
            />
          </div>
        </div>
      </section>

      {/* ── Type + download ────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Type</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['PHYSICAL', 'DIGITAL'] as Kind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => update('kind', k)}
                  className={cn(
                    'flex-1 rounded-[6px] py-2 text-sm font-medium transition-all',
                    draft.kind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  )}
                >
                  {k === 'PHYSICAL' ? 'Physical product' : 'Digital download'}
                </button>
              ))}
            </div>
          </div>

          {draft.kind === 'DIGITAL' && (
            <div className="flex flex-col gap-2 border-t border-slate-200 p-4">
              <label className="text-sm font-medium text-slate-700">Download file</label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => downloadInputRef.current?.click()} disabled={uploadingDownload}>
                  {uploadingDownload
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                    : draft.downloadUrl ? 'Replace file' : 'Upload file'}
                </Button>
                {draft.downloadUrl && (
                  <a href={draft.downloadUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-blue-600 hover:underline">
                    Preview file
                  </a>
                )}
              </div>
              <input
                ref={downloadInputRef}
                type="file"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadDownload(f); e.target.value = '' }}
              />
              <Input
                label="…or paste a URL"
                type="url"
                placeholder="https://…"
                value={draft.downloadUrl ?? ''}
                onChange={e => update('downloadUrl', e.target.value || null)}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── Selling ────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Selling</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          {/* No "require payment to book". A product is BOUGHT, not booked —
              there is no session to hold while an invoice is settled, so the
              question has no answer here. It stays on offerings, where it
              decides whether a seat is reserved before money arrives. */}
          <label className="flex cursor-pointer items-center justify-between gap-3 p-4">
            <span className="flex items-center gap-2.5 text-sm font-medium text-slate-900">
              <Star className="h-[18px] w-[18px] text-slate-700" strokeWidth={1.75} />
              Feature on client home
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.featured}
              onChange={e => update('featured', e.target.checked)}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-slate-200 p-4">
            <span className="flex items-center gap-2.5 text-sm font-medium text-slate-900">
              {draft.active
                ? <Eye className="h-[18px] w-[18px] text-slate-700" strokeWidth={1.75} />
                : <EyeOff className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.75} />}
              Visible to clients
            </span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.active}
              onChange={e => update('active', e.target.checked)}
            />
          </label>
        </div>
      </section>

      {error && <Alert variant="error">{error}</Alert>}

    </div>
  )
}


/**
 * Duplicate and Delete for one product, behind ⋯ .
 *
 * Save is pressed every visit so it stays a labelled button; these two are
 * occasional and one is unrecoverable, so they go in the house sheet — the same
 * one every offering and library screen uses.
 */
function ProductActions({
  productId,
  name,
  onDelete,
}: {
  productId: string
  name: string
  onDelete: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  async function clone() {
    if (busy) return
    setBusy(true)
    setFailed(null)
    try {
      const res = await fetch(`/api/products/${productId}/clone`, { method: 'POST' })
      const body = await res.json().catch(() => null) as { id?: string } | null
      if (res.ok && body?.id) {
        // Land on the copy — a duplicate is never finished as it stands, and it
        // is hidden until the trainer says otherwise.
        router.push(`/products/${body.id}`)
        router.refresh()
        return
      }
      setFailed('Could not copy this product.')
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const actions: SheetAction[] = [
    {
      key: 'clone',
      label: 'Duplicate this product',
      hint: 'Opens a hidden copy for you to change',
      icon: <Copy className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: clone,
      disabled: busy,
    },
    {
      key: 'delete',
      label: 'Delete this product',
      hint: 'Asks first — this can’t be undone',
      icon: <Trash2 className="h-5 w-5" strokeWidth={1.75} />,
      onSelect: () => { setOpen(false); onDelete() },
      disabled: busy,
      danger: true,
    },
  ]

  return (
    <>
      {failed && (
        <span role="alert" className="max-w-[12rem] truncate text-xs text-red-600" title={failed}>{failed}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More actions for this product"
        aria-haspopup="dialog"
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open && <ActionSheet title={name} actions={actions} onClose={() => setOpen(false)} />}
    </>
  )
}
