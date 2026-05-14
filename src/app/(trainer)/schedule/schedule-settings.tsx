'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Settings2, X, Loader2 } from 'lucide-react'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// Built-in option groups. Custom fields are appended at runtime from
// the trainer's CustomField list (parity with the /clients picker).
const SESSION_FIELD_OPTIONS: { id: string; label: string }[] = [
  { id: 'location',    label: 'Location / suburb' },
  { id: 'sessionType', label: 'Session type' },
  { id: 'duration',    label: 'Duration' },
  { id: 'description', label: 'Notes' },
  { id: 'title',       label: 'Title' },
]

const CLIENT_FIELD_OPTIONS: { id: string; label: string }[] = [
  { id: 'email',       label: 'Email' },
  { id: 'extraDogs',   label: 'Additional dogs' },
  { id: 'compliance',  label: '7-day compliance' },
]

const MAX_EXTRA_FIELDS = 2

interface CustomFieldMeta {
  id: string
  label: string
  appliesTo: string
}

/**
 * Trainer-side schedule view preferences: visible hour range and which
 * weekdays render. PATCHes /api/trainer/profile and refreshes the page so
 * the new range applies immediately.
 */
export function ScheduleSettings({
  startHour,
  endHour,
  mobileStartHour,
  mobileEndHour,
  days,
  extraFields,
  customFields,
}: {
  startHour: number
  endHour: number
  // Mobile-specific override. Null = "use desktop hours on mobile too" —
  // when the trainer hasn't customised it, the controls show the
  // desktop hours and stay disabled until they tick the override.
  mobileStartHour: number | null
  mobileEndHour: number | null
  days: number[]   // 1=Mon..7=Sun
  extraFields: string[]
  customFields: CustomFieldMeta[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(startHour)
  const [draftEnd, setDraftEnd] = useState(endHour)
  // Mobile-override state. The toggle stores whether the trainer wants
  // a separate mobile range at all. When off we send nulls on save so
  // the server-side fallback kicks back in. When on, the dropdowns
  // edit the override and seed from the desktop values if there's
  // nothing saved yet.
  const [mobileOverride, setMobileOverride] = useState(mobileStartHour != null && mobileEndHour != null)
  const [draftMobileStart, setDraftMobileStart] = useState(mobileStartHour ?? startHour)
  const [draftMobileEnd, setDraftMobileEnd] = useState(mobileEndHour ?? endHour)
  const [draftDays, setDraftDays] = useState<Set<number>>(new Set(days))
  // Order matters: it's the render order on the block. Keep as a list, not a set.
  const [draftExtra, setDraftExtra] = useState<string[]>(extraFields)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleDay(d: number) {
    setDraftDays(prev => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d); else next.add(d)
      return next
    })
  }

  function setSlot(slot: number, value: string) {
    setDraftExtra(prev => {
      // Strip any duplicate of this value already in the list — the same
      // field can't fill two slots.
      let next = value ? prev.filter(v => v !== value) : [...prev]
      if (value === '') {
        if (slot < next.length) next.splice(slot, 1)
      } else if (slot < next.length) {
        next[slot] = value
      } else if (next.length < MAX_EXTRA_FIELDS) {
        next.push(value)
      }
      return next.slice(0, MAX_EXTRA_FIELDS)
    })
  }

  async function handleSave() {
    setError(null)
    if (draftEnd <= draftStart) { setError('End hour must be after start hour'); return }
    if (mobileOverride && draftMobileEnd <= draftMobileStart) {
      setError('Mobile end hour must be after start hour'); return
    }
    if (draftDays.size === 0) { setError('Pick at least one day'); return }
    setSaving(true)
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduleStartHour: draftStart,
        scheduleEndHour: draftEnd,
        // Send null when the override is off so the server clears any
        // previously-saved phone range and mobile falls back to desktop.
        scheduleMobileStartHour: mobileOverride ? draftMobileStart : null,
        scheduleMobileEndHour: mobileOverride ? draftMobileEnd : null,
        scheduleDays: Array.from(draftDays).sort((a, b) => a - b),
        scheduleExtraFields: draftExtra,
      }),
    })
    setSaving(false)
    if (!res.ok) { setError('Failed to save'); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> View
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Schedule view</h2>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              {error && <p className="text-sm text-red-600">{error}</p>}

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-0.5">Visible hours · Desktop</label>
                <p className="text-[11px] text-slate-400 mb-1.5">Used on tablet and desktop screens.</p>
                <div className="flex items-center gap-2">
                  <select
                    value={draftStart}
                    onChange={e => setDraftStart(Number(e.target.value))}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{labelHour(h)}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">to</span>
                  <select
                    value={draftEnd}
                    onChange={e => setDraftEnd(Number(e.target.value))}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
                      <option key={h} value={h}>{labelHour(h % 24 || 24)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-sm font-medium text-slate-700">Visible hours · Mobile</label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mobileOverride}
                      onChange={e => setMobileOverride(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Different from desktop</span>
                  </label>
                </div>
                <p className="text-[11px] text-slate-400 mb-1.5">
                  {mobileOverride ? 'Used on phones (under 640px wide).' : 'Phones use the desktop range above.'}
                </p>
                <div className={`flex items-center gap-2 ${mobileOverride ? '' : 'opacity-50 pointer-events-none'}`}>
                  <select
                    value={draftMobileStart}
                    onChange={e => setDraftMobileStart(Number(e.target.value))}
                    disabled={!mobileOverride}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{labelHour(h)}</option>
                    ))}
                  </select>
                  <span className="text-slate-400">to</span>
                  <select
                    value={draftMobileEnd}
                    onChange={e => setDraftMobileEnd(Number(e.target.value))}
                    disabled={!mobileOverride}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
                      <option key={h} value={h}>{labelHour(h % 24 || 24)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Days shown</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((label, idx) => {
                    const dayValue = idx + 1   // 1=Mon..7=Sun
                    const active = draftDays.has(dayValue)
                    return (
                      <button
                        key={dayValue}
                        onClick={() => toggleDay(dayValue)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex gap-2 text-[11px]">
                  <button
                    onClick={() => setDraftDays(new Set([1, 2, 3, 4, 5]))}
                    className="text-blue-600 hover:underline"
                  >
                    Weekdays
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    onClick={() => setDraftDays(new Set([1, 2, 3, 4, 5, 6, 7]))}
                    className="text-blue-600 hover:underline"
                  >
                    All week
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Extra block fields</label>
                <p className="text-[11px] text-slate-400 mb-1.5">Up to {MAX_EXTRA_FIELDS} fields shown on each session block.</p>
                <div className="flex flex-col gap-2">
                  {Array.from({ length: MAX_EXTRA_FIELDS }, (_, slot) => (
                    <select
                      key={slot}
                      value={draftExtra[slot] ?? ''}
                      onChange={e => setSlot(slot, e.target.value)}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— None —</option>
                      <optgroup label="Session">
                        {SESSION_FIELD_OPTIONS.map(o => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Client">
                        {CLIENT_FIELD_OPTIONS.map(o => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </optgroup>
                      {customFields.length > 0 && (
                        <optgroup label="Custom fields">
                          {customFields.map(f => (
                            <option key={f.id} value={`custom:${f.id}`}>
                              {f.label} {f.appliesTo === 'DOG' ? '(dog)' : '(owner)'}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function labelHour(h: number): string {
  if (h === 0 || h === 24) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
