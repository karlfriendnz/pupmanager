'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Settings2, X, Loader2 } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'

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
  view,
  onView,
  onOpenAvailability,
  onOpenReport,
  members = [],
  memberFilter = 'all',
  onMemberChange,
  hasUnassigned = false,
  showMemberFilter = false,
}: {
  startHour: number
  endHour: number
  /** Current grid layout, and how to change it — used to live as an icon trio
   *  in the toolbar. */
  view?: 'day' | 'threeDay' | 'week'
  onView?: (v: 'day' | 'threeDay' | 'week') => void
  /** Opens the availability-hours editor (was its own toolbar button). */
  onOpenAvailability?: () => void
  /** Opens the weekly report (was its own toolbar button). */
  onOpenReport?: () => void
  /** Staff filter (was its own toolbar dropdown). */
  members?: { id: string; name: string }[]
  memberFilter?: string
  onMemberChange?: (v: string) => void
  hasUnassigned?: boolean
  showMemberFilter?: boolean
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

  // Standing rule: never two scrollbars. While this panel is up the page
  // behind it must not scroll — otherwise the panel scrolls, the page scrolls,
  // and you get two rails down the screen.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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
      {/* Icon only — the panel names itself once open, and the label cost the
          date row width it needed. */}
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Schedule view options" title="View options">
        <Settings2 className="h-4 w-4" />
      </Button>
      {/* A whole screen on a phone, a centred card from sm: up. It had no
          max-height and no scroll, so on a phone the content ran past the
          bottom of the screen and took Save — and the X — with it. */}
      {open && (
        <ModalPortal>
        <div className="pm-overlay fixed inset-0 z-[70] flex justify-center sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative z-50 flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[85vh] sm:max-w-sm sm:rounded-2xl sm:shadow-2xl"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-900">Schedule view</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto no-scrollbar p-5">
              {error && <p className="text-sm text-red-600">{error}</p>}

              {/* Everything that used to be its own toolbar icon lives here:
                  layout, whose calendar you're looking at, and availability. */}
              {view && onView && (
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Layout</label>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                    {([
                      { id: 'day' as const, label: 'Day' },
                      { id: 'threeDay' as const, label: '3 days' },
                      { id: 'week' as const, label: 'Week' },
                    ]).map(v => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onView(v.id)}
                        aria-pressed={view === v.id}
                        className={`h-9 rounded-lg text-sm font-medium transition-colors ${
                          view === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showMemberFilter && onMemberChange && (
                <div>
                  <label htmlFor="pm-schedule-member" className="text-sm font-medium text-slate-700 block mb-1.5">
                    Whose calendar
                  </label>
                  <select
                    id="pm-schedule-member"
                    value={memberFilter}
                    onChange={e => onMemberChange(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">Everyone</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    {hasUnassigned && <option value="unassigned">Unassigned</option>}
                  </select>
                </div>
              )}

              {(onOpenAvailability || onOpenReport) && (
                <div className="overflow-hidden rounded-xl border border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-200">
                  {onOpenAvailability && (
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onOpenAvailability() }}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Availability hours
                      <span className="text-xs text-slate-400">When you take bookings</span>
                    </button>
                  )}
                  {/* The weekly report kept its own toolbar icon for one modal.
                      It lives here now rather than being deleted outright. */}
                  {onOpenReport && (
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onOpenReport() }}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Weekly report
                      <span className="text-xs text-slate-400">Hours and sessions</span>
                    </button>
                  )}
                </div>
              )}

              <div className="hidden sm:block">
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
                  <label className="text-sm font-medium text-slate-700">
                    <span className="sm:hidden">Visible hours</span>
                    <span className="hidden sm:inline">Visible hours · Mobile</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={mobileOverride}
                      onChange={e => setMobileOverride(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="sm:hidden">Set for phone</span>
                    <span className="hidden sm:inline">Different from desktop</span>
                  </label>
                </div>
                <p className="text-[11px] text-slate-400 mb-1.5">
                  {mobileOverride
                    ? 'Used on phones (under 640px wide).'
                    : 'Phones use the same range as desktop.'}
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
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-slate-700">Days shown</label>
                  <div className="flex gap-3 text-[11px]">
                    <button onClick={() => setDraftDays(new Set([1, 2, 3, 4, 5]))} className="text-blue-600 hover:underline">
                      Weekdays
                    </button>
                    <button onClick={() => setDraftDays(new Set([1, 2, 3, 4, 5, 6, 7]))} className="text-blue-600 hover:underline">
                      All week
                    </button>
                  </div>
                </div>
                {/* Seven across, one row. Big round pills wrapped 6-then-1 on a
                    phone, which read as a mistake rather than a control. */}
                <div className="grid grid-cols-7 gap-1">
                  {DAY_LABELS.map((label, idx) => {
                    const dayValue = idx + 1   // 1=Mon..7=Sun
                    const active = draftDays.has(dayValue)
                    return (
                      <button
                        key={dayValue}
                        onClick={() => toggleDay(dayValue)}
                        aria-pressed={active}
                        className={`h-10 rounded-lg border text-[11px] font-medium transition-colors ${
                          active
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {/* Two letters, not one — "T" and "S" each name two
                            days. */}
                        {label.slice(0, 2)}
                        <span className="hidden sm:inline">{label.slice(2)}</span>
                      </button>
                    )
                  })}
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

            </div>

            {/* Pinned so Save is reachable however long the form gets, and
                clear of the home indicator. */}
            <div
              className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-4"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
            >
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  )
}

function labelHour(h: number): string {
  if (h === 0 || h === 24) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
