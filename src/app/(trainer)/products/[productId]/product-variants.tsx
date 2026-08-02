'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { SortableOfferingCard, SortableOfferingList } from '@/components/shared/offering-card'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol, formatMoney } from '@/lib/money'
import { readApiError } from '@/lib/api-error'
import { compressImageFile } from '@/lib/compress-image'
import {
  resolveVariantPricing,
  resolveVariantPresentation,
  effectivePriceCents,
  validateSalePrice,
} from '@/lib/product-price'
import { StockSheet } from '../stock-sheet'

/**
 * The sizes and colours one product comes in.
 *
 * FLAT NAMED ROWS. "Small", "Large", "Red · Large" — the name is the choice a
 * client makes. Not an option-axis matrix: that is several times the work and
 * this is a dog trainer's shop, where a harness has three sizes and a lead has
 * two colours. (Axes stay a possible upgrade — a generator would write these
 * same rows.)
 *
 * Two rules the layout exists to make obvious:
 *
 *  • PRICE INHERITS. Leaving the price blank means "same as the product", so
 *    five sizes at one price is typed once, on the Details tab. The greyed
 *    placeholder shows the number that will actually be charged so nobody has
 *    to guess what blank means.
 *
 *  • THE LEDGER OWNS THE COUNT. Stock is text with a button beside it, never a
 *    field — the same treatment the product's own count already gets, for the
 *    same reason: typing 9 over 12 records nothing about the three that went.
 *    A brand-new row is the exception (there is no history to keep yet), so it
 *    takes an opening count inline.
 *
 *  • PHOTO AND NOTES INHERIT TOO, and they open in a SHEET, not inline. The
 *    row is already six controls wide and has to survive 390px; a rich-text
 *    editor and an upload box per row would turn a nine-size list into nine
 *    screens of scrolling, and a trainer setting prices would be wading past
 *    editors they never opened. So the row carries a thumbnail — small, and
 *    the thing that tells you at a glance whether this size has a picture of
 *    its own — and pressing it opens the house overlay (FullScreenSheet: the
 *    whole screen on a phone, a panel on desktop) with the photo and the words
 *    together. They belong together: both answer "what does the client see
 *    when they pick THIS one".
 */

export interface VariantDraft {
  /** Absent on a row that hasn't been saved yet. */
  id?: string
  /** Stable key for dnd-kit and React — a saved id, or a local one. */
  key: string
  name: string
  sku: string | null
  priceCents: number | null
  salePriceCents: number | null
  /** Null = the product's photo. */
  imageUrl: string | null
  /** Null/blank = the product's description. Tiptap HTML. */
  description: string | null
  stockCount: number | null
  active: boolean
}

export interface VariantRow {
  id: string
  name: string
  sku: string | null
  priceCents: number | null
  salePriceCents: number | null
  imageUrl: string | null
  description: string | null
  stockCount: number | null
  active: boolean
}

/** cents → the string a money input holds. */
function toInput(cents: number | null) {
  return cents != null ? (cents / 100).toFixed(2) : ''
}

/** the string a money input holds → cents, or undefined when unreadable. */
function toCents(value: string): number | null | undefined {
  if (value.trim() === '') return null
  const n = Math.round(parseFloat(value) * 100)
  return Number.isNaN(n) || n < 0 ? undefined : n
}

let localSeq = 0

export function ProductVariants({
  productId,
  productName,
  productPriceCents,
  productSalePriceCents,
  productImageUrl,
  productDescription,
  initial,
}: {
  productId: string
  productName: string
  /** What a variant inherits when its own price is blank. */
  productPriceCents: number | null
  productSalePriceCents: number | null
  /** What a variant inherits when its own photo/notes are blank. */
  productImageUrl: string | null
  productDescription: string | null
  initial: VariantRow[]
}) {
  const currency = useCurrency()
  const symbol = currencySymbol(currency)

  const [rows, setRows] = useState<VariantDraft[]>(() =>
    initial.map(v => ({ ...v, key: v.id })),
  )
  // Money is held as TEXT while it is being typed — "1." and "" are states a
  // number can't hold, and reparsing on every keystroke fights the caret.
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map(v => [v.id, toInput(v.priceCents)])),
  )
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [stockFor, setStockFor] = useState<VariantDraft | null>(null)
  // Which row's photo + notes are open. A key, not the row itself, so the sheet
  // always reads the CURRENT draft — a stale copy would put back the old name
  // in its title after a rename behind it.
  const [mediaKey, setMediaKey] = useState<string | null>(null)
  const mediaRow = rows.find(r => r.key === mediaKey) ?? null

  const inherited = effectivePriceCents({ priceCents: productPriceCents, salePriceCents: productSalePriceCents })

  function patch(key: string, next: Partial<VariantDraft>) {
    setSaved(false)
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...next } : r)))
  }

  function add(name: string) {
    const clean = name.trim()
    if (!clean) return
    if (rows.some(r => r.name.trim().toLowerCase() === clean.toLowerCase())) {
      setError('There is already an option with that name.')
      return
    }
    setError(null)
    setSaved(false)
    const key = `new_${localSeq++}`
    setRows(prev => [...prev, {
      key,
      name: clean,
      sku: null,
      priceCents: null,
      salePriceCents: null,
      // Blank = inherits the product's. A new size is the same thing in a
      // different size far more often than it is a different-looking thing.
      imageUrl: null,
      description: null,
      stockCount: null,
      active: true,
    }])
    setPrices(prev => ({ ...prev, [key]: '' }))
    setDraft('')
  }

  function remove(key: string) {
    setSaved(false)
    setRows(prev => prev.filter(r => r.key !== key))
  }

  function reorder(keys: string[]) {
    setSaved(false)
    setRows(keys.map(k => rows.find(r => r.key === k)!).filter(Boolean))
  }

  async function save() {
    setError(null)
    const payload: {
      id?: string
      name: string
      sku: string | null
      priceCents: number | null
      salePriceCents: number | null
      imageUrl: string | null
      description: string | null
      stockCount: number | null
      active: boolean
    }[] = []

    for (const r of rows) {
      if (!r.name.trim()) { setError('Every option needs a name.'); return }
      const cents = toCents(prices[r.key] ?? '')
      if (cents === undefined) { setError(`${r.name}: price must be a positive number.`); return }
      // The same rule the server applies, so a pair it would reject is refused
      // here with a sentence rather than on save.
      const problem = validateSalePrice(cents ?? productPriceCents, r.salePriceCents)
      if (r.salePriceCents != null && problem) { setError(`${r.name}: ${problem}`); return }
      payload.push({
        ...(r.id ? { id: r.id } : {}),
        name: r.name.trim(),
        sku: r.sku,
        priceCents: cents ?? null,
        salePriceCents: r.salePriceCents,
        // Always sent, because this editor now OWNS both: "cleared the photo"
        // has to reach the server as null, and an absent key would mean
        // "leave it" and quietly keep the old one.
        imageUrl: r.imageUrl,
        description: r.description,
        // Only read for a NEW row — the server ignores it on one that exists,
        // because the ledger owns that count.
        stockCount: r.stockCount,
        active: r.active,
      })
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants: payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Could not save these options.')); return }
      const next: VariantRow[] = body.variants ?? []
      setRows(next.map(v => ({ ...v, key: v.id })))
      setPrices(Object.fromEntries(next.map(v => [v.id, toInput(v.priceCents)])))
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 flex items-end justify-between gap-3 border-b border-slate-200 bg-slate-50/95 px-4 pb-1.5 pt-1 backdrop-blur md:mx-0 md:px-0">
        <span className="pb-1 text-sm text-slate-500">
          {rows.length === 0
            ? 'No options — this product is sold as one thing.'
            : `${rows.length} option${rows.length === 1 ? '' : 's'}`}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2 pb-1">
          {saved && <span className="text-xs text-slate-500">Saved</span>}
          <Button size="sm" loading={saving} onClick={save}>Save options</Button>
        </span>
      </div>

      <p className="text-sm text-slate-600">
        Sizes, colours, weights — whatever a client has to pick before they can
        buy. Leave a price blank and it costs{' '}
        {inherited != null ? formatMoney(inherited, currency) : 'whatever the product costs'}, the
        product&rsquo;s own price.
      </p>

      {rows.length > 0 && (
        // Keyed by the row's own key, not its index: an index renumbers on
        // every drag and dnd-kit would move the wrong row.
        <SortableOfferingList ids={rows.map(r => r.key)} onReorder={reorder}>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
            {rows.map((r, i) => {
              const resolved = resolveVariantPricing(
                { priceCents: productPriceCents, salePriceCents: productSalePriceCents },
                { priceCents: toCents(prices[r.key] ?? '') ?? null, salePriceCents: r.salePriceCents },
              )
              const shown = effectivePriceCents(resolved)
              return (
                <SortableOfferingCard key={r.key} id={r.key}>
                  {handle => (
                    // A phone gets the name on its own line with the numbers
                    // under it; there is no room for six controls across 390px.
                    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        {handle}
                        <VariantThumbButton
                          row={r}
                          productImageUrl={productImageUrl}
                          productDescription={productDescription}
                          onOpen={() => setMediaKey(r.key)}
                        />
                        <input
                          value={r.name}
                          onChange={e => patch(r.key, { name: e.target.value })}
                          placeholder={`Option ${i + 1}`}
                          aria-label={`Name for option ${i + 1}`}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 text-sm font-medium text-slate-900 hover:border-slate-200 focus:border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                        <span className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">{symbol}</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            value={prices[r.key] ?? ''}
                            onChange={e => { setSaved(false); setPrices(p => ({ ...p, [r.key]: e.target.value })) }}
                            // The placeholder is the number that WILL be
                            // charged, so "blank" never has to be guessed at.
                            placeholder={inherited != null ? (inherited / 100).toFixed(2) : 'Price'}
                            aria-label={`Price for ${r.name || `option ${i + 1}`}`}
                            className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-300"
                          />
                        </span>

                        <input
                          value={r.sku ?? ''}
                          onChange={e => patch(r.key, { sku: e.target.value || null })}
                          placeholder="SKU"
                          aria-label={`SKU for ${r.name || `option ${i + 1}`}`}
                          className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />

                        {/* Stock. A saved row goes through the sheet (which
                            asks what happened); a row that has never been
                            saved has no history to keep, so it takes an
                            opening count here. */}
                        {r.id ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setStockFor(r)}>
                            {r.stockCount == null ? 'Not counted' : `${r.stockCount} on hand`}
                          </Button>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={r.stockCount ?? ''}
                            onChange={e => patch(r.key, { stockCount: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                            placeholder="Stock"
                            aria-label={`Opening count for ${r.name || `option ${i + 1}`}`}
                            className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-300"
                          />
                        )}

                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={r.active}
                            onChange={e => patch(r.key, { active: e.target.checked })}
                          />
                          Visible
                        </label>

                        <span className="w-20 text-right text-xs tabular-nums text-slate-500">
                          {shown != null ? formatMoney(shown, currency) : '—'}
                        </span>

                        <button
                          type="button"
                          onClick={() => remove(r.key)}
                          aria-label={`Remove ${r.name || `option ${i + 1}`}`}
                          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  )}
                </SortableOfferingCard>
              )
            })}
          </div>
        </SortableOfferingList>
      )}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } }}
          placeholder="Add an option — “Large”, “Red”, “1kg”"
          aria-label="New option name"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          aria-label="Add this option"
          className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {rows.length > 0 && (
        <p className="text-xs text-slate-500">
          With options set, the count that matters is each option&rsquo;s — the
          product&rsquo;s own stock number is no longer used, and a client picks
          one before they can buy. Tap an option&rsquo;s picture to give that one
          its own photo and notes.
        </p>
      )}

      {mediaRow && (
        <VariantMediaSheet
          key={mediaRow.key}
          row={mediaRow}
          productName={productName}
          productImageUrl={productImageUrl}
          productDescription={productDescription}
          onChange={next => patch(mediaRow.key, next)}
          onClose={() => setMediaKey(null)}
        />
      )}

      {stockFor?.id && (
        <StockSheet
          productId={productId}
          productName={`${productName} · ${stockFor.name}`}
          variantId={stockFor.id}
          stockCount={stockFor.stockCount}
          onClose={() => setStockFor(null)}
          // Stays open: a trainer booking in a delivery often records two
          // things in a row, and the sheet is where the history is.
          onChanged={next => patch(stockFor.key, { stockCount: next })}
        />
      )}
    </div>
  )
}

/**
 * The row's picture, and the way in to its photo + notes.
 *
 * It shows what the CLIENT will see for this option, which for most rows is the
 * product's photo — greyed back, with the word "Shared" under a corner dot when
 * this one has something of its own. An empty box would read as a missing
 * picture; a faded product photo reads as "this one uses that", which is the
 * truth and the thing the trainer needs to know before deciding to change it.
 */
function VariantThumbButton({
  row,
  productImageUrl,
  productDescription,
  onOpen,
}: {
  row: VariantDraft
  productImageUrl: string | null
  productDescription: string | null
  onOpen: () => void
}) {
  const shown = resolveVariantPresentation(
    { imageUrl: productImageUrl, description: productDescription },
    row,
  )
  const own = !shown.inheritsImage || !shown.inheritsDescription
  const what = row.name || 'this option'

  return (
    <button
      type="button"
      onClick={onOpen}
      title={own ? `${what} has its own photo or notes` : `${what} uses the product’s photo and notes`}
      aria-label={
        own
          ? `Photo and notes for ${what} — it has its own`
          : `Photo and notes for ${what} — using the product’s`
      }
      className="relative grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 hover:border-slate-300"
    >
      {shown.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown.imageUrl}
          alt=""
          className={`h-full w-full object-cover ${shown.inheritsImage ? 'opacity-50' : ''}`}
        />
      ) : (
        <ImagePlus className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
      )}
      {own && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-slate-900 ring-2 ring-white" />
      )}
    </button>
  )
}

/**
 * One option's photo and notes.
 *
 * Why a sheet and not fields in the row: see the note at the top of this file —
 * the row has to survive 390px, and an editor per row would bury the prices.
 *
 * Why no Save button of its own: the list has ONE save, and a second one here
 * would leave a trainer wondering which of the two kept their work (and which
 * one loses it if they press the wrong one). Changes go into the same draft the
 * name and price do, and "Save options" writes the lot.
 *
 * BLANK MEANS INHERIT, and both fields say so out loud rather than sitting
 * empty — an empty description box beside a product that HAS a description is
 * indistinguishable from a description that got lost.
 */
function VariantMediaSheet({
  row,
  productName,
  productImageUrl,
  productDescription,
  onChange,
  onClose,
}: {
  row: VariantDraft
  productName: string
  productImageUrl: string | null
  productDescription: string | null
  onChange: (next: Partial<VariantDraft>) => void
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The words are held LOCALLY while they are typed and pushed up on close.
  // Tiptap fires per keystroke, and patching the parent each time re-renders
  // every row in a list that can hold a hundred of them.
  const [html, setHtml] = useState(row.description ?? '')

  function close() {
    onChange({ description: html.trim() === '' ? null : html })
    onClose()
  }

  async function upload(file: File) {
    setError(null)
    setUploading(true)
    try {
      // Compressed client-side, exactly as the product's own photo is: the
      // upload route sits behind Vercel's 4.5MB body cap and a phone photo of
      // a harness goes straight past it.
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'product')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Upload failed')); return }
      onChange({ imageUrl: body.url })
    } finally {
      setUploading(false)
    }
  }

  const usingProductPhoto = !row.imageUrl
  const shownPhoto = row.imageUrl ?? productImageUrl

  return (
    <FullScreenSheet
      title="Photo and notes"
      sub={`${productName} · ${row.name || 'this option'}`}
      onClose={close}
      footer={<Button className="w-full" onClick={close}>Done</Button>}
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-700">Photo</p>
          <div className="mt-2 aspect-4/3 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {shownPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shownPhoto}
                alt=""
                className={`h-full w-full object-cover ${usingProductPhoto ? 'opacity-60' : ''}`}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImagePlus className="h-6 w-6 text-slate-400" strokeWidth={1.75} />
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {usingProductPhoto
              ? shownPhoto
                ? 'Using the product’s photo. Upload one to show this option instead.'
                : 'The product has no photo either. Upload one to show for this option.'
              : 'This option has its own photo.'}
          </p>
          <div className="mt-2 flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                : row.imageUrl ? 'Replace photo' : 'Upload photo'}
            </Button>
            {row.imageUrl && (
              <button
                type="button"
                onClick={() => onChange({ imageUrl: null })}
                className="px-2 text-xs text-slate-400 hover:text-red-500"
              >
                Use the product&rsquo;s
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-700">Notes for this option</p>
          <p className="mt-1 text-xs text-slate-500">
            What is true of THIS one — &ldquo;fits 12&ndash;18kg&rdquo;,
            &ldquo;deep chest&rdquo;. Leave it blank and the product&rsquo;s own
            description is shown, as it is now.
          </p>
          <div className="mt-2">
            {/* Keyed by the row so the editor mounts with the right document —
                RichTextEditor takes its initial content once, by design. */}
            <RichTextEditor
              key={row.key}
              value={html}
              onChange={setHtml}
              theme="light"
              minHeight={160}
            />
          </div>
          {html.trim() === '' && productDescription && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Clients will see the product&rsquo;s description
              </p>
              <RichText html={productDescription} className="mt-1 text-sm text-slate-600" />
            </div>
          )}
        </div>

        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </FullScreenSheet>
  )
}
