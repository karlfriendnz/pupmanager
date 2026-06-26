'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { PlaceAutocomplete, type PlaceResult } from '@/components/maps/place-autocomplete'

// "Base of operations" — the start/end point the route planner calculates
// travel from ("leave from and return to base"). Renders as a field inside the
// Business details form and saves the same baseAddress/baseLat/baseLng/
// basePlaceId the route manager writes, via the shared /api/route/base endpoint,
// so the two stay in sync. Saves immediately on pick (independent of the form's
// Save button).
export function BaseLocationSetting({ initialBase }: {
  initialBase: { address: string | null; lat: number | null; lng: number | null } | null
}) {
  const [base, setBase] = useState<string | null>(initialBase?.address ?? null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSelect(r: PlaceResult) {
    setSaving(true); setSaved(false); setError(null)
    try {
      const res = await fetch('/api/route/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: r.address, lat: r.lat, lng: r.lng, placeId: r.placeId }),
      })
      if (!res.ok) throw new Error('save failed')
      setBase(r.address)
      setSaved(true)
    } catch {
      setError('Could not save — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">Base of operations</label>
      <PlaceAutocomplete
        onSelect={onSelect}
        initialValue={initialBase?.address ?? ''}
        bias={initialBase?.lat != null && initialBase?.lng != null ? { lat: initialBase.lat, lng: initialBase.lng } : null}
        placeholder={base ? 'Change base address…' : 'Search your base address…'}
      />
      <p className="text-xs text-slate-500">
        Where your day starts and ends. The route planner calculates travel from here — leave from and return to base.
        {saving && <span className="ml-1 text-slate-400">Saving…</span>}
        {saved && !saving && <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}
        {error && <span className="ml-1 text-rose-600">{error}</span>}
      </p>
    </div>
  )
}
