'use client'

// Reusable discount editor for any offering. Lists an offering's discounts,
// adds the common presets in one tap (whole-day/week, second-dog, early-bird),
// and edits amount/type/target inline. Backed by /api/trainer/discounts and the
// shared evaluator, so what's configured here is what the client is charged.
import { useState, useEffect, useCallback } from 'react'
import { Percent, Tag, Loader2, Plus, Trash2, Pencil, Check, X, Star } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol } from '@/lib/money'
import { DISCOUNT_PRESETS } from '@/lib/discounts/presets'
import { Switch } from '@/components/ui/switch'

type ModifierType = 'PERCENT' | 'FLAT' | 'REPLACE'
type ApplyTo = 'per_item' | 'per_person' | 'cheapest_item' | 'most_expensive_item' | 'order_total'
interface Cond { key: string; operator?: string; value?: unknown }
interface Discount {
  id: string; name: string; formText: string | null
  modifierType: ModifierType; modifierValue: number; applyTo: ApplyTo
  conditions: Cond[]; isActive: boolean
}

const APPLY_TO: { key: ApplyTo; label: string }[] = [
  { key: 'order_total', label: 'the whole booking' },
  { key: 'per_person', label: 'per dog' },
  { key: 'per_item', label: 'per item' },
  { key: 'cheapest_item', label: 'the cheapest item' },
  { key: 'most_expensive_item', label: 'the priciest item' },
]

function condLabel(c: Cond): string {
  switch (c.key) {
    case 'booked_full_day': return 'Whole day booked'
    case 'booked_full_week': return 'Whole week booked'
    case 'group_size_min': return `${Number(c.value) || 2}+ dogs together`
    case 'booking_date_before': return c.value ? `Before ${new Date(String(c.value)).toLocaleDateString()}` : 'Before a date'
    default: return c.key
  }
}

export function DiscountManager({ packageId }: { packageId: string }) {
  const currency = useCurrency()
  const sym = currencySymbol(currency)
  const [discounts, setDiscounts] = useState<Discount[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Discount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/trainer/discounts?packageId=${packageId}`).then(r => (r.ok ? r.json() : [])).catch(() => [])
    setDiscounts(res)
  }, [packageId])
  useEffect(() => { load() }, [load])

  async function api(path: string, init: RequestInit): Promise<Response | null> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
      if (!res.ok) { setError('Something went wrong — please try again.'); return null }
      return res
    } catch { setError('Something went wrong — please try again.'); return null } finally { setBusy(false) }
  }

  async function addPreset(key: string) {
    const p = DISCOUNT_PRESETS.find(x => x.key === key)!
    setPicking(false)
    const res = await api('/api/trainer/discounts', {
      method: 'POST',
      body: JSON.stringify({ packageId, name: p.label, modifierType: p.modifierType, modifierValue: p.modifierValue, applyTo: p.applyTo, conditions: p.conditions }),
    })
    if (!res) return
    const d: Discount = await res.json()
    setDiscounts(prev => [...(prev ?? []), d])
    setDraft({ ...d }); setEditingId(d.id)
  }

  async function saveDraft() {
    if (!draft) return
    const res = await api(`/api/trainer/discounts/${draft.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: draft.name, modifierType: draft.modifierType, modifierValue: draft.modifierValue, applyTo: draft.applyTo, conditions: draft.conditions, isActive: draft.isActive }),
    })
    if (!res) return
    const saved: Discount = await res.json()
    setDiscounts(prev => (prev ?? []).map(d => (d.id === saved.id ? saved : d)))
    setEditingId(null); setDraft(null)
  }

  async function toggle(d: Discount) {
    setDiscounts(prev => (prev ?? []).map(x => (x.id === d.id ? { ...x, isActive: !x.isActive } : x)))
    await api(`/api/trainer/discounts/${d.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !d.isActive }) })
  }
  async function remove(id: string) {
    const res = await api(`/api/trainer/discounts/${id}`, { method: 'DELETE' })
    if (res) setDiscounts(prev => (prev ?? []).filter(d => d.id !== id))
  }

  const patch = (p: Partial<Discount>) => setDraft(d => (d ? { ...d, ...p } : d))
  const setBeforeDate = (iso: string) => patch({ conditions: draft!.conditions.map(c => (c.key === 'booking_date_before' ? { ...c, value: iso ? new Date(iso).toISOString() : null } : c)) })

  function amountLabel(d: Discount): string {
    if (d.modifierType === 'PERCENT') return `${d.modifierValue}% off`
    if (d.modifierType === 'REPLACE') return `Set to ${sym}${(d.modifierValue / 100).toFixed(2)}`
    return `${sym}${(d.modifierValue / 100).toFixed(2)} off`
  }

  if (discounts === null) return <div className="flex items-center gap-2 text-sm text-slate-500 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading discounts…</div>

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="p-5 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2"><Tag className="h-4 w-4 text-teal-600" /> Discounts</h3>
        <p className="text-sm text-slate-500 mt-0.5">Deals that apply automatically at checkout — whole-day, whole-week, second-dog and more.</p>
      </div>

      {error && <div className="mx-5 mt-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      <div className="p-4 sm:p-5 flex flex-col gap-3">
        {discounts.map(d =>
          editingId === d.id && draft ? (
            <div key={d.id} className="rounded-xl border-2 border-teal-200 bg-teal-50/40 p-4 flex flex-col gap-3">
              <input value={draft.name} onChange={e => patch({ name: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm" placeholder="Discount name" />
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5">
                  {(['PERCENT', 'FLAT', 'REPLACE'] as ModifierType[]).map(t => (
                    <button key={t} onClick={() => patch({ modifierType: t })} className={`px-2.5 h-8 text-xs font-medium rounded-md ${draft.modifierType === t ? 'bg-teal-600 text-white' : 'text-slate-600'}`}>
                      {t === 'PERCENT' ? '% off' : t === 'FLAT' ? `${sym} off` : 'Set price'}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  {draft.modifierType === 'PERCENT'
                    ? <input value={draft.modifierValue} onChange={e => patch({ modifierValue: Math.min(100, Number(e.target.value.replace(/[^0-9]/g, '')) || 0) })} inputMode="numeric" className="h-9 w-20 rounded-lg border border-slate-200 pl-2.5 pr-6 text-sm" />
                    : <input value={(draft.modifierValue / 100).toString()} onChange={e => patch({ modifierValue: Math.round((Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) * 100) })} inputMode="decimal" className="h-9 w-24 rounded-lg border border-slate-200 pl-6 pr-2 text-sm" />}
                  <span className={`absolute top-1/2 -translate-y-1/2 text-slate-400 text-sm ${draft.modifierType === 'PERCENT' ? 'right-2' : 'left-2'}`}>{draft.modifierType === 'PERCENT' ? '%' : sym}</span>
                </div>
                <span className="text-sm text-slate-500">off</span>
                <select value={draft.applyTo} onChange={e => patch({ applyTo: e.target.value as ApplyTo })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">
                  {APPLY_TO.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
              {draft.conditions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {draft.conditions.map((c, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{condLabel(c)}</span>)}
                  {draft.conditions.some(c => c.key === 'booking_date_before') && (
                    <input type="date" onChange={e => setBeforeDate(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs" />
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => { setEditingId(null); setDraft(null) }} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /> Cancel</button>
                <button onClick={saveDraft} disabled={busy || !draft.name.trim()} className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
              </div>
            </div>
          ) : (
            <div key={d.id} className={`rounded-xl border border-slate-200 p-3.5 flex items-start gap-3 ${d.isActive ? 'bg-white' : 'bg-slate-50 opacity-70'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-slate-900">{d.name}</span>
                  <span className="text-sm text-teal-700 font-medium">{amountLabel(d)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {d.conditions.length === 0
                    ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Always applies</span>
                    : d.conditions.map((c, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{condLabel(c)}</span>)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={d.isActive} onChange={() => toggle(d)} disabled={busy} onColor="bg-teal-600" aria-label={d.isActive ? 'Turn off' : 'Turn on'} />
                <button onClick={() => { setDraft({ ...d }); setEditingId(d.id) }} disabled={busy} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(d.id)} disabled={busy} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ),
        )}

        {picking ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DISCOUNT_PRESETS.map(p => (
              <button key={p.key} onClick={() => addPreset(p.key)} disabled={busy} className="text-left rounded-lg border border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40 p-2.5 disabled:opacity-60">
                <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">{p.key === 'second_dog' ? <Star className="h-3.5 w-3.5 text-amber-500" /> : <Percent className="h-3.5 w-3.5 text-teal-600" />}{p.label}</div>
                <div className="text-xs text-slate-500">{p.description}</div>
              </button>
            ))}
            <button onClick={() => setPicking(false)} className="text-xs text-slate-500 hover:text-slate-700 justify-self-start px-1 py-1">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setPicking(true)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60 self-start">
            <Plus className="h-4 w-4" /> Add discount
          </button>
        )}
      </div>
    </div>
  )
}
