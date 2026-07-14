'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CLIENT_FIELDS, type ClientFieldKey, type ResolvedFieldConfig } from '@/lib/client-fields'

// The built-in client/dog details (name, phone, address, dog name, breed, …).
// They back real columns, so they're configured rather than created: "Required"
// (on the full create-client form) and "Quick-add" (shown on + required by the
// quick-add contact form). Custom fields carry the same two switches inline on
// their own rows in the field list above, so they aren't repeated here.
export function ClientFieldsConfig() {
  const [config, setConfig] = useState<ResolvedFieldConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/clients/field-config')
      .then(r => r.json())
      .then(d => setConfig(d.config))
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
          <h3 className="text-sm font-semibold text-slate-800">Client &amp; dog details</h3>
          <p className="text-xs text-slate-400 mt-0.5">Built-in fields, asked when you create a client. Choose which are required, and which show on quick-add.</p>
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
      </div>
    </div>
  )
}
