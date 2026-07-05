'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, PawPrint, User, ArrowUpRight } from 'lucide-react'
import type { ResolvedFieldConfig } from '@/lib/client-fields'
import { buildFieldRows, rowsToFieldConfig, type FieldRow } from '@/lib/onboarding/client-fields-setup'

// Wizard step: a guided, friendly version of the Settings → Forms client-field
// config. Loads the current config from the SAME endpoint the settings UI reads
// (/api/clients/field-config), lets the trainer choose which built-in fields to
// capture (Include), which show on the fast quick-add form (Quick add) and
// which are mandatory (Required). It hands the live config up via onConfigChange;
// the wizard persists it through PATCH /api/trainer/profile on Continue.

export function ClientFieldsStep({
  onConfigChange,
}: {
  onConfigChange: (config: ResolvedFieldConfig | null) => void
}) {
  const [rows, setRows] = useState<FieldRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/clients/field-config')
      .then(r => r.json())
      .then((d: { config: ResolvedFieldConfig }) => {
        if (cancelled) return
        setRows(buildFieldRows(d.config))
      })
      .catch(() => { if (!cancelled) setError('Could not load your fields.') })
    return () => { cancelled = true }
  }, [])

  // Push the serialized config up whenever the rows change so the wizard always
  // has the latest to persist on Continue.
  useEffect(() => {
    onConfigChange(rows ? rowsToFieldConfig(rows) : null)
  }, [rows, onConfigChange])

  function update(key: string, patch: Partial<Pick<FieldRow, 'include' | 'quickAdd' | 'required'>>) {
    setRows(prev => prev && prev.map(r => {
      if (r.key !== key || r.locked) return r
      const next = { ...r, ...patch }
      // Marking Quick add or Required implies the field is included; turning
      // Include off leaves the sub-values but they're ignored when serialized.
      if (patch.quickAdd || patch.required) next.include = true
      return next
    }))
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your fields…
      </div>
    )
  }

  const owner = rows.filter(r => r.scope === 'OWNER')
  const dog = rows.filter(r => r.scope === 'DOG')

  return (
    <div key="s-fields">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">Set up your client form</h2>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
          Choose what to capture when you add a client. <span className="font-medium text-slate-600">Quick add</span> shows the field on the fast add form; <span className="font-medium text-slate-600">Required</span> makes it mandatory. We&apos;ve suggested a sensible starting point for dog trainers.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <FieldGroup title="Owner details" icon={<User className="h-4 w-4" />} rows={owner} onUpdate={update} />
        <FieldGroup title="Dog details" icon={<PawPrint className="h-4 w-4" />} rows={dog} onUpdate={update} />
      </div>

      <p className="mt-5 text-[13px] text-slate-500 leading-relaxed">
        You can add your own custom fields and change any of this later in{' '}
        <Link href="/settings?tab=forms" className="font-medium text-teal-700 hover:underline inline-flex items-center gap-0.5">
          Settings → Forms <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>.
      </p>
    </div>
  )
}

function FieldGroup({
  title, icon, rows, onUpdate,
}: {
  title: string
  icon: React.ReactNode
  rows: FieldRow[]
  onUpdate: (key: string, patch: Partial<Pick<FieldRow, 'include' | 'quickAdd' | 'required'>>) => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50/70 text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        <span className="ml-auto flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <span className="w-14 text-center">Include</span>
          <span className="w-16 text-center">Quick add</span>
          <span className="w-16 text-center">Required</span>
        </span>
      </div>
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100">
          <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
            {r.label}
            {r.locked && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">always</span>}
          </span>
          <div className="flex items-center gap-4">
            <span className="w-14 flex justify-center">
              <Check3
                on={r.include}
                disabled={r.locked}
                onToggle={() => onUpdate(r.key, { include: !r.include })}
                label={`Include ${r.label}`}
              />
            </span>
            <span className="w-16 flex justify-center">
              <Check3
                on={r.include && r.quickAdd}
                dim={!r.include}
                onToggle={() => onUpdate(r.key, { quickAdd: !r.quickAdd })}
                label={`Quick add ${r.label}`}
              />
            </span>
            <span className="w-16 flex justify-center">
              <Check3
                on={r.locked || (r.include && r.required)}
                disabled={r.locked}
                dim={!r.include}
                onToggle={() => onUpdate(r.key, { required: !r.required })}
                label={`Require ${r.label}`}
              />
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// Square checkbox styled like the wizard's other pickers.
function Check3({
  on, disabled, dim, onToggle, label,
}: {
  on: boolean
  disabled?: boolean
  dim?: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`h-6 w-6 rounded-md border-2 flex items-center justify-center transition-colors ${
        on ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-teal-400'} ${
        dim && !on ? 'opacity-40' : ''
      }`}
    >
      {on && <Check className="h-3.5 w-3.5 text-white" />}
    </button>
  )
}
