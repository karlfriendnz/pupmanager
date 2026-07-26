'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { XeroAccountField } from '@/components/shared/xero-account-field'
import { RequirePaymentField } from '@/components/shared/require-payment-field'
import { SectionLabel } from '@/components/shared/flat-list'
import { isRichTextEmpty } from '@/lib/rich-text'
import { compressImageFile } from '@/lib/compress-image'
import { readApiError } from '@/lib/api-error'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol, formatMoney } from '@/lib/money'
import { savingPercent, validateSalePrice } from '@/lib/product-price'
import { cn } from '@/lib/utils'
import { Eye, EyeOff, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react'

export type Kind = 'PHYSICAL' | 'DIGITAL'

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
}: {
  initial: ProductDraft
  isNew: boolean
  existingCategories: string[]
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
  const [uploadingImg, setUploadingImg] = useState(false)
  const [uploadingDownload, setUploadingDownload] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const downloadInputRef = useRef<HTMLInputElement>(null)

  function update<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  // Live sale preview — the same rule the server enforces, so the trainer never
  // finds out on save.
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
      stockCount: draft.stockCount ?? null,
      imageUrl: draft.imageUrl,
      downloadUrl: draft.downloadUrl,
      category: draft.category,
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
      {/* ── What it looks like ─────────────────────────────────────────── */}
      <section>
        <SectionLabel>Listing</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-4 p-4">
            <div className="h-20 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {draft.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImagePlus className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => imgInputRef.current?.click()} disabled={uploadingImg}>
                {uploadingImg
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                  : draft.imageUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {draft.imageUrl && (
                <button type="button" onClick={() => update('imageUrl', null)} className="px-3 text-xs text-slate-400 hover:text-red-500">
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

          <div className="border-t border-slate-200 p-4">
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

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label className="text-sm font-medium text-slate-700">Category</label>
            <input
              list="product-categories"
              value={draft.category ?? ''}
              onChange={e => update('category', e.target.value || null)}
              placeholder="Treats, Equipment, Guides…"
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="product-categories">
              {existingCategories.map(c => <option key={c} value={c} />)}
            </datalist>
            <p className="text-xs text-slate-500">Type a new one or pick an existing.</p>
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

      {/* ── Price ──────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Price</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-1.5 p-4">
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

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label htmlFor="product-sale-price" className="text-sm font-medium text-slate-700">Sale price</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">{symbol}</span>
              <input
                id="product-sale-price"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="Leave blank — not on sale"
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
            <p className={cn('text-xs', salePreviewIsError ? 'text-red-600' : 'text-slate-500')}>
              {salePreview ?? 'Set this and clients are charged it instead — the normal price shows struck through.'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Stock ──────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Stock</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-1.5 p-4">
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
          </div>
        </div>
      </section>

      {/* ── Selling ────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Selling</SectionLabel>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="p-4">
            <XeroAccountField
              value={draft.xeroAccountCode ?? ''}
              onChange={v => update('xeroAccountCode', v || null)}
            />
          </div>
          <div className="border-t border-slate-200 p-4">
            <RequirePaymentField
              value={draft.requirePayment}
              onChange={v => update('requirePayment', v)}
            />
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-slate-200 p-4">
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

      {!isNew && (
        <div>
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" size="sm" loading={deleting} onClick={remove}>Confirm delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete this product
            </button>
          )}
        </div>
      )}

      {/* Pinned action bar — thumb-reachable on a phone, and the only Save.
          Sticky rather than fixed so it can't collide with the desktop sidebar;
          it spans the gutter on a phone and becomes a card on a desktop. */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border md:px-5">
        <Button variant="ghost" size="sm" onClick={() => router.push('/products')}>Cancel</Button>
        <Button size="sm" loading={saving} onClick={save} disabled={!draft.name.trim()}>
          {isNew ? 'Create product' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
