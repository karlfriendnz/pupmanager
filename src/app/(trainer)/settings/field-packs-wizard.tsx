'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { packsForRoles, recommendedFieldKeys, type FieldPack } from '@/lib/field-packs'

// "What do you want to capture about your clients?" — the step that stops a new
// trainer staring at an empty field list. Packs are pre-selected from the roles
// they picked during onboarding; they tick fields off, and we create the fields
// and their sections in one go.
export function FieldPacksWizard({
  roles,
  onClose,
}: {
  roles: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const packs = useMemo(() => packsForRoles(roles), [roles])
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(recommendedFieldKeys(roles))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleField(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function togglePack(pack: FieldPack, on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const f of pack.fields) {
        const key = `${pack.id}:${f.key}`
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  async function create() {
    if (selected.size === 0) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/custom-fields/packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [...selected] }),
      })
      if (!res.ok) {
        setError('Could not add those fields. Please try again.')
        setSaving(false)
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Could not add those fields. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-6">
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-slate-900">
              What do you want to capture about your clients?
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              We&apos;ve ticked the usual ones for the work you do. Untick anything you don&apos;t
              need — you can always add more later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {packs.map(pack => {
            const keys = pack.fields.map(f => `${pack.id}:${f.key}`)
            const allOn = keys.every(k => selected.has(k))
            return (
              <div key={pack.id} className="rounded-2xl border border-slate-200">
                <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{pack.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{pack.blurb}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePack(pack, !allOn)}
                    className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
                  >
                    {allOn ? 'None' : 'All'}
                  </button>
                </div>
                <div className="p-2 flex flex-wrap gap-1.5">
                  {pack.fields.map(f => {
                    const key = `${pack.id}:${f.key}`
                    const on = selected.has(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleField(key)}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          on
                            ? 'border-teal-200 bg-teal-50 text-teal-800'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {selected.size} field{selected.size === 1 ? '' : 's'} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
              Skip for now
            </Button>
            <Button size="sm" onClick={create} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Add {selected.size} field{selected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
