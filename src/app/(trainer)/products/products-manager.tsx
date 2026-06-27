'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import {
  Plus, Pencil, Trash2, Star, Eye, EyeOff, ImagePlus, Loader2, X, Tag,
  Package as PackageIcon, FileDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { compressImageFile } from '@/lib/compress-image'

type Kind = 'PHYSICAL' | 'DIGITAL'

interface Product {
  id: string
  name: string
  description: string | null
  kind: Kind
  priceCents: number | null
  imageUrl: string | null
  downloadUrl: string | null
  category: string | null
  featured: boolean
  active: boolean
}

const EMPTY_DRAFT: Omit<Product, 'id'> = {
  name: '',
  description: null,
  kind: 'PHYSICAL',
  priceCents: null,
  imageUrl: null,
  downloadUrl: null,
  category: null,
  featured: false,
  active: true,
}

function formatPrice(cents: number | null) {
  if (cents == null) return 'Contact'
  return `$${(cents / 100).toFixed(2)}`
}

export function ProductsManager({ initialProducts }: { initialProducts: Product[] }) {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  // Group by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>()
    for (const p of products) {
      const key = p.category ?? 'Uncategorised'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1
      if (b === 'Uncategorised') return -1
      return a.localeCompare(b)
    })
  }, [products])

  const existingCategories = useMemo(
    () => Array.from(new Set(products.map(p => p.category).filter(Boolean) as string[])).sort(),
    [products]
  )

  return (
    <div className="flex flex-col gap-6">
      <Button onClick={() => setCreating(true)} className="self-start">
        <Plus className="h-4 w-4 mr-1" /> Add product
      </Button>

      {products.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <PackageIcon className="h-8 w-8 text-slate-300 mx-auto" />
            <p className="mt-3 text-sm font-medium text-slate-600">No products yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Add your first product to start selling to your clients.
            </p>
          </CardBody>
        </Card>
      ) : (
        grouped.map(([cat, items]) => (
          <div key={cat} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-1">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">{cat}</h2>
              <span className="text-xs text-slate-400">{items.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onEdit={() => setEditing(p)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {(creating || editing) && (
        <ProductEditor
          initial={editing ?? { ...EMPTY_DRAFT, id: '' }}
          isNew={creating}
          existingCategories={existingCategories}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSave={(saved) => {
            if (creating) {
              setProducts(prev => [saved, ...prev])
            } else {
              setProducts(prev => prev.map(p => p.id === saved.id ? saved : p))
            }
            setCreating(false)
            setEditing(null)
            router.refresh()
          }}
          onDelete={(id) => {
            setProducts(prev => prev.filter(p => p.id !== id))
            setCreating(false)
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function ProductCard({ product, onEdit }: { product: Product; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className={cn(
        'text-left rounded-2xl bg-white border border-slate-100 overflow-hidden hover:border-slate-200 hover:shadow-sm transition-all',
        !product.active && 'opacity-60'
      )}
    >
      <div className="aspect-video bg-gradient-to-br from-amber-50 to-rose-50 relative flex items-center justify-center">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} className="absolute inset-0 h-full w-full object-cover" />
        ) : product.kind === 'DIGITAL' ? (
          <FileDown className="h-7 w-7 text-violet-400" />
        ) : (
          <PackageIcon className="h-7 w-7 text-amber-400" />
        )}

        {product.featured && (
          <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-100 backdrop-blur px-2 py-0.5 rounded-full">
            <Star className="h-3 w-3 fill-current" /> Featured
          </span>
        )}
        {!product.active && (
          <span className="absolute top-2 right-2 text-[10px] font-medium text-slate-700 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full">
            Hidden
          </span>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900 line-clamp-1">{product.name}</p>
          <span className="text-sm font-semibold text-slate-700 flex-shrink-0">{formatPrice(product.priceCents)}</span>
        </div>
        <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mt-0.5">
          {product.kind === 'DIGITAL' ? 'Digital' : 'Physical'}
        </p>
      </div>
    </button>
  )
}

function ProductEditor({
  initial,
  isNew,
  existingCategories,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Product
  isNew: boolean
  existingCategories: string[]
  onClose: () => void
  onSave: (p: Product) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<Product>(initial)
  const [priceInput, setPriceInput] = useState(
    initial.priceCents != null ? (initial.priceCents / 100).toFixed(2) : ''
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const downloadInputRef = useRef<HTMLInputElement>(null)
  const [uploadingDownload, setUploadingDownload] = useState(false)

  function update<K extends keyof Product>(key: K, value: Product[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  async function uploadImage(file: File) {
    setError(null)
    setUploadingImg(true)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'product')
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Upload failed')
        return
      }
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
      // Reuse the branding-image endpoint — it accepts any file type so long
      // as the client treats it as a generic upload. (Same Vercel Blob bucket.)
      const res = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Upload failed')
        return
      }
      update('downloadUrl', body.url)
    } finally {
      setUploadingDownload(false)
    }
  }

  async function save() {
    setError(null)
    setSaving(true)

    const parsedPrice = priceInput.trim() === '' ? null : Math.round(parseFloat(priceInput) * 100)
    if (parsedPrice != null && (Number.isNaN(parsedPrice) || parsedPrice < 0)) {
      setError('Price must be a positive number')
      setSaving(false)
      return
    }

    const payload = {
      name: draft.name,
      description: draft.description,
      kind: draft.kind,
      priceCents: parsedPrice,
      imageUrl: draft.imageUrl,
      downloadUrl: draft.downloadUrl,
      category: draft.category,
      featured: draft.featured,
      active: draft.active,
    }

    try {
      const res = await fetch(
        isNew ? '/api/products' : `/api/products/${draft.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Save failed')
        return
      }
      onSave({
        id: body.id,
        name: body.name,
        description: body.description,
        kind: body.kind,
        priceCents: body.priceCents,
        imageUrl: body.imageUrl,
        downloadUrl: body.downloadUrl,
        category: body.category,
        featured: body.featured,
        active: body.active,
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft.id) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${draft.id}`, { method: 'DELETE' })
      if (res.ok) onDelete(draft.id)
      else setError('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-xl bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white">
          <h2 className="text-lg font-semibold text-slate-900">
            {isNew ? 'New product' : 'Edit product'}
          </h2>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Image */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Image</label>
            <div className="flex items-center gap-4">
              <div className="h-24 w-32 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                {draft.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => imgInputRef.current?.click()} disabled={uploadingImg}>
                  {uploadingImg ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : (draft.imageUrl ? 'Replace' : 'Upload image')}
                </Button>
                {draft.imageUrl && (
                  <button type="button" onClick={() => update('imageUrl', null)} className="text-xs text-slate-400 hover:text-red-500 self-start">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) uploadImage(f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Name */}
          <Input
            label="Name"
            value={draft.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Long line · 5m"
          />

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <textarea
              rows={3}
              value={draft.description ?? ''}
              onChange={e => update('description', e.target.value || null)}
              placeholder="What it is, who it's for, why it helps."
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
          </div>

          {/* Kind */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Type</label>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {(['PHYSICAL', 'DIGITAL'] as Kind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => update('kind', k)}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
                    draft.kind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  )}
                >
                  {k === 'PHYSICAL' ? 'Physical product' : 'Digital download'}
                </button>
              ))}
            </div>
          </div>

          {/* Download (digital only) */}
          {draft.kind === 'DIGITAL' && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700">Download file</label>
              <div className="flex items-center gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => downloadInputRef.current?.click()} disabled={uploadingDownload}>
                  {uploadingDownload ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : (draft.downloadUrl ? 'Replace file' : 'Upload file')}
                </Button>
                {draft.downloadUrl && (
                  <a href={draft.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate max-w-xs">
                    Preview file
                  </a>
                )}
              </div>
              <input
                ref={downloadInputRef}
                type="file"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) uploadDownload(f)
                  e.target.value = ''
                }}
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

          {/* Price */}
          <Input
            label="Price"
            type="number"
            step="0.01"
            min="0"
            placeholder="29.00 — leave blank for 'Contact'"
            value={priceInput}
            onChange={e => setPriceInput(e.target.value)}
          />

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Category</label>
            <input
              list="product-categories"
              value={draft.category ?? ''}
              onChange={e => update('category', e.target.value || null)}
              placeholder="Treats, Equipment, Guides…"
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="product-categories">
              {existingCategories.map(c => <option key={c} value={c} />)}
            </datalist>
            <p className="text-[11px] text-slate-400">Type a new one or pick an existing.</p>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 cursor-pointer">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Star className="h-4 w-4 text-amber-500" />
                Feature on client home
              </span>
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={draft.featured}
                onChange={e => update('featured', e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 cursor-pointer">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                {draft.active ? <Eye className="h-4 w-4 text-emerald-500" /> : <EyeOff className="h-4 w-4 text-slate-400" />}
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

          {error && <Alert variant="error">{error}</Alert>}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 px-5 py-4 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
          {!isNew && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button variant="danger" size="sm" loading={deleting} onClick={remove}>Confirm delete</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )
          )}
          <div className={cn('flex gap-2', isNew && 'ml-auto')}>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={save} disabled={!draft.name.trim()}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {isNew ? 'Create' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
