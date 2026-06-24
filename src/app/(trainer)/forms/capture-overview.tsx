'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type Cell = 'required' | 'optional' | 'no'
export type FormKey = 'intake' | 'full' | 'quick'
export type Row = { label: string; isCustom: boolean; cells: Record<FormKey, Cell> }

const FORMS: { key: FormKey; label: string; hint: string }[] = [
  { key: 'intake', label: 'Intake', hint: 'Client fills on first login' },
  { key: 'full', label: 'New client', hint: 'You create the full profile' },
  { key: 'quick', label: 'Quick add', hint: 'Fast in-person capture' },
]

function CellBadge({ cell }: { cell: Cell }) {
  if (cell === 'no') return <span className="text-slate-300">—</span>
  const required = cell === 'required'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${required ? 'bg-accent-soft text-accent-strong' : 'bg-slate-100 text-slate-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${required ? 'bg-accent' : 'bg-slate-400'}`} />
      {required ? 'Required' : 'Optional'}
    </span>
  )
}

// One scope section (Client or Dog): the field × form matrix plus an
// "Add field" affordance that creates a custom field in this scope.
function Section({ title, scope, rows }: { title: string; scope: 'OWNER' | 'DOG'; rows: Row[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<'TEXT' | 'NUMBER' | 'DROPDOWN'>('TEXT')
  const [options, setOptions] = useState('')
  const [required, setRequired] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() { setLabel(''); setType('TEXT'); setOptions(''); setRequired(false); setQuickAdd(false); setError(null) }

  async function save() {
    if (!label.trim()) { setError('Give the field a name.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/custom-fields', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(), type, appliesTo: scope, required, inQuickAdd: quickAdd,
          options: type === 'DROPDOWN' ? options.split(',').map(o => o.trim()).filter(Boolean) : undefined,
        }),
      })
      if (!res.ok) { setError('Could not add field.'); return }
      setAdding(false); reset(); router.refresh()
    } finally { setBusy(false) }
  }

  const inputCls = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        <button type="button" onClick={() => { reset(); setAdding(a => !a) }} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong">
          <Plus className="h-4 w-4" /> Add field
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Field</th>
              {FORMS.map(f => (
                <th key={f.key} className="px-4 py-3 text-center">
                  <span className="block font-semibold text-slate-700">{f.label}</span>
                  <span className="block text-[11px] font-normal text-slate-400">{f.hint}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-4 py-2.5">
                  <span className="text-slate-800">{r.label}</span>
                  {r.isCustom && <span className="ml-1.5 text-[10px] text-slate-400">custom</span>}
                </td>
                {FORMS.map(f => <td key={f.key} className="px-4 py-2.5 text-center"><CellBadge cell={r.cells[f.key]} /></td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={1 + FORMS.length} className="px-4 py-4 text-center text-sm text-slate-400">No fields yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-600 block mb-1">Field name</label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={scope === 'DOG' ? 'e.g. Microchip number' : 'e.g. Emergency contact'} />
            </div>
            <div className="sm:w-40">
              <label className="text-xs font-medium text-slate-600 block mb-1">Type</label>
              <select value={type} onChange={e => setType(e.target.value as typeof type)} className={inputCls}>
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="DROPDOWN">Dropdown</option>
              </select>
            </div>
          </div>
          {type === 'DROPDOWN' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Options (comma-separated)</label>
              <Input value={options} onChange={e => setOptions(e.target.value)} placeholder="Small, Medium, Large" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--accent)]" />
              Required (intake + new client)
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={quickAdd} onChange={e => setQuickAdd(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--accent)]" />
              Show on quick-add
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); reset() }} disabled={busy}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} loading={busy} disabled={busy}><Check className="h-4 w-4" /> Add field</Button>
          </div>
        </div>
      )}
    </section>
  )
}

export function CaptureOverview({ clientRows, dogRows }: { clientRows: Row[]; dogRows: Row[] }) {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Client" scope="OWNER" rows={clientRows} />
      <Section title="Dog" scope="DOG" rows={dogRows} />
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Required</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Optional</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-slate-300">—</span> Not on this form</span>
      </div>
    </div>
  )
}
