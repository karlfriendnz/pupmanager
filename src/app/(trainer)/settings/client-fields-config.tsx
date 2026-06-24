'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CLIENT_FIELDS, type ClientFieldKey, type ResolvedFieldConfig } from '@/lib/client-fields'

type QuickCustomField = {
  id: string; label: string; required: boolean; inQuickAdd: boolean; appliesTo: 'OWNER' | 'DOG'
}

// Per-company config for what's captured when creating a client. Two switches
// per field: "Required" (on the full create form) and "Quick-add" (shown in +
// required for the quick-add contact form). Lives inside the intake builder.
export function ClientFieldsConfig() {
  const [config, setConfig] = useState<ResolvedFieldConfig | null>(null)
  const [custom, setCustom] = useState<QuickCustomField[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/clients/field-config')
      .then(r => r.json())
      .then(d => { setConfig(d.config); setCustom(d.customFields ?? []) })
      .catch(() => setError('Could not load field settings.'))
  }, [])

  async function saveBuiltins(next: ResolvedFieldConfig) {
    setConfig(next)
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientFieldConfig: next }),
      })
      if (!res.ok) setError('Save failed.')
    } finally { setSaving(false) }
  }

  function toggleBuiltin(key: ClientFieldKey, prop: 'required' | 'quickAdd', value: boolean) {
    if (!config) return
    saveBuiltins({ ...config, [key]: { ...config[key], [prop]: value } })
  }

  async function toggleCustomQuick(id: string, value: boolean) {
    setCustom(prev => prev.map(f => f.id === id ? { ...f, inQuickAdd: value } : f))
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/custom-fields/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inQuickAdd: value }),
      })
      if (!res.ok) setError('Save failed.')
    } finally { setSaving(false) }
  }

  if (error && !config) return <p className="text-sm text-red-600">{error}</p>
  if (!config) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>

  const Toggle = ({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className={`inline-flex items-center gap-1.5 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--accent)]" />
      {label}
    </label>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Client capture fields</h3>
          <p className="text-xs text-slate-400 mt-0.5">Choose what&apos;s required when creating a client, and what shows on the quick-add form.</p>
        </div>
        {saving && <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="rounded-2xl border border-slate-100 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <span>Field</span><span className="w-20 text-center">Required</span><span className="w-20 text-center">Quick-add</span>
        </div>
        {CLIENT_FIELDS.map(f => (
          <div key={f.key} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-t border-slate-100">
            <span className="text-sm text-slate-700">{f.label}{f.scope === 'DOG' && <span className="ml-1.5 text-[10px] text-slate-400">dog</span>}</span>
            <span className="w-20 flex justify-center">
              <Toggle on={config[f.key].required} disabled={f.alwaysRequired} onChange={v => toggleBuiltin(f.key, 'required', v)} label="" />
            </span>
            <span className="w-20 flex justify-center">
              <Toggle on={config[f.key].quickAdd} onChange={v => toggleBuiltin(f.key, 'quickAdd', v)} label="" />
            </span>
          </div>
        ))}
        {custom.map(f => (
          <div key={f.id} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-t border-slate-100">
            <span className="text-sm text-slate-700">{f.label}<span className="ml-1.5 text-[10px] text-slate-400">{f.appliesTo === 'DOG' ? 'dog · custom' : 'custom'}</span></span>
            <span className="w-20 flex justify-center text-[11px] text-slate-400">{f.required ? 'Yes' : '—'}</span>
            <span className="w-20 flex justify-center">
              <Toggle on={f.inQuickAdd} onChange={v => toggleCustomQuick(f.id, v)} label="" />
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Custom-field &ldquo;Required&rdquo; is set on each field above in the form builder; here you choose whether it appears on quick-add.</p>
    </div>
  )
}
