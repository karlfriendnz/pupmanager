'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, Package as PackageIcon, Pencil, Trash2, X, ChevronUp, ChevronDown } from 'lucide-react'

type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

const COLOR_OPTIONS: { id: PackageColor; label: string; swatch: string }[] = [
  { id: 'blue',    label: 'Blue',    swatch: 'bg-blue-500' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'amber',   label: 'Amber',   swatch: 'bg-amber-500' },
  { id: 'rose',    label: 'Rose',    swatch: 'bg-rose-500' },
  { id: 'purple',  label: 'Purple',  swatch: 'bg-purple-500' },
  { id: 'orange',  label: 'Orange',  swatch: 'bg-orange-500' },
  { id: 'teal',    label: 'Teal',    swatch: 'bg-teal-500' },
  { id: 'indigo',  label: 'Indigo',  swatch: 'bg-indigo-500' },
  { id: 'pink',    label: 'Pink',    swatch: 'bg-pink-500' },
  { id: 'cyan',    label: 'Cyan',    swatch: 'bg-cyan-500' },
]

interface PkgRow {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  specialPriceCents: number | null
  color: PackageColor | null
  assignments: number
}

// We collect price as a decimal string from the user (e.g. "120" or "120.50")
// then convert to cents server-side. This keeps the input UX natural without
// pulling in a money/decimal library.
const formSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  // 0 = ongoing — the trainer picks an end date when assigning the package.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  price: z.string().optional(),
  specialPrice: z.string().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
})

function dollarsToCents(s: string | undefined): number | null {
  if (!s || !s.trim()) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

function formatPrice(cents: number | null): string | null {
  if (cents === null || cents === undefined) return null
  // Locale-friendly: "$120" or "$120.50"
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(cents / 100)
}

// Static class map — Tailwind purges dynamic class names so each package
// colour needs its own listed pair here.
const PACKAGE_ICON_CLASSES: Record<PackageColor, string> = {
  blue:    'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50 text-amber-600',
  rose:    'bg-rose-50 text-rose-600',
  purple:  'bg-purple-50 text-purple-600',
  orange:  'bg-orange-50 text-orange-600',
  teal:    'bg-teal-50 text-teal-600',
  indigo:  'bg-indigo-50 text-indigo-600',
  pink:    'bg-pink-50 text-pink-600',
  cyan:    'bg-cyan-50 text-cyan-600',
}
function packageIconClasses(color: PackageColor | null): string {
  return color ? PACKAGE_ICON_CLASSES[color] : 'bg-blue-50 text-blue-600'
}

type FormValues = z.infer<typeof formSchema>

export function PackagesView({ initialPackages }: { initialPackages: PkgRow[] }) {
  const [packages, setPackages] = useState(initialPackages)
  const [editing, setEditing] = useState<PkgRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  function upsert(p: PkgRow, isNew: boolean) {
    setPackages(prev => isNew ? [p, ...prev] : prev.map(x => x.id === p.id ? p : x))
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this package? Existing client assignments stay (but their sessions remain on the schedule).')) return
    const res = await fetch(`/api/packages/${id}`, { method: 'DELETE' })
    if (res.ok) setPackages(prev => prev.filter(p => p.id !== id))
  }

  async function move(id: string, direction: -1 | 1) {
    setPackages(prev => {
      const idx = prev.findIndex(p => p.id === id)
      const target = idx + direction
      if (idx === -1 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[idx], next[target]] = [next[target], next[idx]]
      // Persist new order — fire-and-forget; on failure we re-fetch via reload.
      void fetch('/api/packages/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map(p => p.id) }),
      }).then(res => {
        if (!res.ok) window.location.reload()
      })
      return next
    })
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packages</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bundles of sessions you can assign to clients in one go.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New package
        </Button>
      </div>

      {packages.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-slate-400">
            <PackageIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No packages yet. Create your first one to get started.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {packages.map((p, idx) => {
            const isFirst = idx === 0
            const isLast = idx === packages.length - 1
            return (
              <Card key={p.id} className="hover:border-blue-100 transition-colors">
                <CardBody className="py-4">
                  <div className="flex items-start gap-4">
                    {/* Reorder controls */}
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        onClick={() => move(p.id, -1)}
                        disabled={isFirst}
                        className="p-0.5 text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => move(p.id, 1)}
                        disabled={isLast}
                        className="p-0.5 text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>

                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${packageIconClasses(p.color)}`}>
                      <PackageIcon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        {p.priceCents !== null && (
                          <span className="text-sm font-medium text-slate-700">
                            {p.specialPriceCents !== null ? (
                              <>
                                <span className="text-emerald-600">{formatPrice(p.specialPriceCents)}</span>
                                <span className="text-slate-400 line-through ml-1.5 text-xs">{formatPrice(p.priceCents)}</span>
                              </>
                            ) : (
                              formatPrice(p.priceCents)
                            )}
                          </span>
                        )}
                      </div>
                      {p.description && <p className="text-sm text-slate-500 mt-0.5">{p.description}</p>}
                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-1.5 flex-wrap">
                        <span>{p.sessionCount === 0 ? 'Ongoing' : `${p.sessionCount} sessions`}</span>
                        <span>·</span>
                        <span>{p.weeksBetween === 0 ? 'No spacing' : `every ${p.weeksBetween} week${p.weeksBetween > 1 ? 's' : ''}`}</span>
                        <span>·</span>
                        <span>{p.durationMins} min</span>
                        <span>·</span>
                        <span>{p.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'}</span>
                        {p.assignments > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-blue-600">{p.assignments} assigned</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEditing(p)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {(showCreate || editing) && (
        <PackageModal
          existing={editing}
          onClose={() => { setShowCreate(false); setEditing(null) }}
          onSaved={(p, isNew) => { upsert(p, isNew); setShowCreate(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function PackageModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: PkgRow | null
  onClose: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState<PackageColor | null>(existing?.color ?? null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          sessionCount: existing.sessionCount,
          weeksBetween: existing.weeksBetween,
          durationMins: existing.durationMins,
          sessionType: existing.sessionType,
          price: centsToDollars(existing.priceCents),
          specialPrice: centsToDollars(existing.specialPriceCents),
        }
      : { sessionCount: 3, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', price: '', specialPrice: '' },
  })

  async function onSubmit(values: FormValues) {
    setError(null)
    const url = existing ? `/api/packages/${existing.id}` : '/api/packages'
    const method = existing ? 'PATCH' : 'POST'
    // Convert the dollar-string price fields into cents before sending; the
    // server stores cents to dodge floating-point math.
    const { price, specialPrice, ...rest } = values
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rest,
        description: values.description || null,
        priceCents: dollarsToCents(price),
        specialPriceCents: dollarsToCents(specialPrice),
        color,
      }),
    })
    if (!res.ok) { setError('Failed to save.'); return }
    const saved = await res.json()
    onSaved(
      {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        sessionCount: saved.sessionCount,
        weeksBetween: saved.weeksBetween,
        durationMins: saved.durationMins,
        sessionType: saved.sessionType,
        priceCents: saved.priceCents ?? null,
        specialPriceCents: saved.specialPriceCents ?? null,
        color: saved.color ?? null,
        assignments: existing?.assignments ?? 0,
      },
      !existing
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">{existing ? 'Edit package' : 'New package'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 flex flex-col gap-3">
          {error && <Alert variant="error">{error}</Alert>}

          <Input label="Name" placeholder="Paws 2" error={errors.name?.message} {...register('name')} />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Description (optional)</label>
            <textarea
              {...register('description')}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input
                label="Number of sessions"
                type="number"
                error={errors.sessionCount?.message}
                {...register('sessionCount', { valueAsNumber: true })}
              />
              <p className="text-[11px] text-slate-400 mt-1">0 = ongoing (you set an end date when assigning)</p>
            </div>
            <Input
              label="Weeks between"
              type="number"
              error={errors.weeksBetween?.message}
              {...register('weeksBetween', { valueAsNumber: true })}
            />
          </div>

          <Input
            label="Default duration (mins)"
            type="number"
            error={errors.durationMins?.message}
            {...register('durationMins', { valueAsNumber: true })}
          />

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Session type</label>
            <div className="flex gap-2">
              {(['IN_PERSON', 'VIRTUAL'] as const).map(t => (
                <label key={t} className="flex-1">
                  <input type="radio" value={t} className="sr-only peer" {...register('sessionType')} />
                  <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                    {t === 'IN_PERSON' ? '📍 In person' : '💻 Virtual'}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Pricing — leave price blank for "no price set". The special price
              is independent and only shown when populated. */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Price"
              type="text"
              inputMode="decimal"
              placeholder="120"
              {...register('price')}
            />
            <Input
              label="Special price (optional)"
              type="text"
              inputMode="decimal"
              placeholder="—"
              {...register('specialPrice')}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Schedule colour</label>
            <p className="text-[11px] text-slate-400 mb-1.5">Sessions assigned to this package will use this colour on the calendar. Leave blank to keep the default status colour.</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
                  color === null
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Default
              </button>
              {COLOR_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setColor(opt.id)}
                  aria-label={opt.label}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${opt.swatch} ${color === opt.id ? 'border-slate-900 ring-2 ring-slate-300' : 'border-white shadow-sm hover:scale-110'}`}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" loading={isSubmitting}>{existing ? 'Save changes' : 'Create package'}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
