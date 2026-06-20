'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import type { BookingPageRow, AutomationRow, AutomationTrigger, PkgOption } from './booking-pages-manager'

const DAYS: { n: number; label: string }[] = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
]

// Full editor for a single booking page, on its own route (/website/booking/<id>).
export function BookingPageEditor({
  page,
  packages,
  publicUrlBase,
}: {
  page: BookingPageRow
  packages: PkgOption[]
  // `${origin}/c/<trainerSlug>/book` or null if the trainer has no slug yet.
  publicUrlBase: string | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'settings' | 'automations'>('settings')
  const [cfg, setCfg] = useState<BookingPageRow>(page)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fullUrl = publicUrlBase ? `${publicUrlBase}/${cfg.slug}` : null

  function set<K extends keyof BookingPageRow>(key: K, value: BookingPageRow[K]) {
    setCfg(c => ({ ...c, [key]: value }))
    setSaved(false)
  }

  function toggleDay(n: number) {
    setCfg(c => ({ ...c, availDays: c.availDays.includes(n) ? c.availDays.filter(d => d !== n) : [...c.availDays, n].sort((a, b) => a - b) }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/trainer/booking-pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cfg.name,
          slug: cfg.slug,
          enabled: cfg.enabled,
          headline: cfg.headline,
          intro: cfg.intro,
          slotLengthMins: cfg.slotLengthMins,
          slotIntervalMins: cfg.slotIntervalMins,
          requiresApproval: cfg.requiresApproval,
          requiresPayment: cfg.requiresPayment,
          priceCents: cfg.priceCents,
          minNoticeHours: cfg.minNoticeHours,
          windowDays: cfg.windowDays,
          availDays: cfg.availDays,
          availStartTime: cfg.availStartTime || null,
          availEndTime: cfg.availEndTime || null,
          packageId: cfg.packageId,
          sessionType: cfg.sessionType,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not save. Check the values and try again.')
        return
      }
      setCfg({ ...body, automations: cfg.automations })
      setSaved(true)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function deletePage() {
    if (!confirm('Delete this booking page? Any link to it will stop working.')) return
    setDeleting(true)
    const res = await fetch(`/api/trainer/booking-pages/${page.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/website')
    else setDeleting(false)
  }

  const pkg = packages.find(p => p.id === cfg.packageId) ?? null
  const hasOwnHours = !!(cfg.availStartTime && cfg.availEndTime)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1 border-b border-slate-200">
        {(['settings', 'automations'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`relative px-4 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t}
            {t === 'automations' && cfg.automations.length > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{cfg.automations.length}</span>
            )}
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-blue-600" />}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
      <>
      {/* Basics */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <label className="block text-xs font-medium text-slate-700">Page name</label>
            <input
              value={cfg.name}
              onChange={e => set('name', e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="pt-6"><Toggle checked={cfg.enabled} onChange={v => set('enabled', v)} label="Live" /></div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-700">Link slug</label>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-slate-400">/book/</span>
            <input
              value={cfg.slug}
              onChange={e => set('slug', e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {fullUrl && (
            <div className="mt-1.5 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{fullUrl}</p>
              <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700">
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Availability window */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Availability</h3>
        <p className="mt-1 text-xs text-slate-400">
          The days and hours this page offers slots. Leave the times blank to use your schedule availability instead.
        </p>

        <label className="mt-4 block text-xs font-medium text-slate-700">Days</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DAYS.map(d => {
            const on = cfg.availDays.includes(d.n)
            return (
              <button
                key={d.n}
                type="button"
                onClick={() => toggleDay(d.n)}
                className={`h-9 w-12 rounded-lg border text-xs font-medium transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                {d.label}
              </button>
            )
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Start time</label>
            <input
              type="time"
              value={cfg.availStartTime ?? ''}
              onChange={e => set('availStartTime', e.target.value || null)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">End time</label>
            <input
              type="time"
              value={cfg.availEndTime ?? ''}
              onChange={e => set('availEndTime', e.target.value || null)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {hasOwnHours
            ? `Offering ${cfg.availStartTime}–${cfg.availEndTime} on the selected days.`
            : 'Using your schedule availability — set both times above to override it for this page.'}
        </p>
      </section>

      {/* What gets booked */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">What gets booked</h3>
        <label className="mt-4 block text-xs font-medium text-slate-700">Package (optional)</label>
        <select
          value={cfg.packageId ?? ''}
          onChange={e => set('packageId', e.target.value || null)}
          className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Single session (no package)</option>
          {packages.map(p => (
            <option key={p.id} value={p.id}>{p.name} · {p.sessionCount > 1 ? `${p.sessionCount} sessions` : '1 session'}</option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-slate-400">
          {pkg
            ? `The chosen time becomes session 1; the remaining ${Math.max(0, pkg.sessionCount - 1)} auto-schedule on the package cadence.`
            : 'Each booking creates one session of the length below.'}
        </p>

        {!cfg.packageId && (
          <>
            <label className="mt-4 block text-xs font-medium text-slate-700">Session type</label>
            <select
              value={cfg.sessionType}
              onChange={e => set('sessionType', e.target.value as BookingPageRow['sessionType'])}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="IN_PERSON">In person</option>
              <option value="VIRTUAL">Virtual</option>
            </select>
          </>
        )}

        {/* Payment — requires the trainer to have payments switched on (Settings
            → Payments). When on, the slot is held until the client pays. */}
        <div className="mt-5 flex items-start justify-between gap-4 border-t border-slate-100 pt-4">
          <div>
            <p className="text-sm font-medium text-slate-800">Require payment to book</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {cfg.packageId
                ? 'Charges the package price. The slot is booked once paid.'
                : 'Client pays before the slot is confirmed. Turn on payments in Settings → Payments first.'}
            </p>
          </div>
          <Toggle checked={cfg.requiresPayment} onChange={v => set('requiresPayment', v)} label="Require payment" />
        </div>
        {cfg.requiresPayment && !cfg.packageId && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-slate-700">Price</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={cfg.priceCents == null ? '' : (cfg.priceCents / 100).toString()}
              onChange={e => {
                const v = e.target.value
                set('priceCents', v === '' ? null : Math.round(parseFloat(v) * 100))
              }}
              placeholder="0.00"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-400">Charged in your payout currency.</p>
          </div>
        )}
      </section>

      {/* Slots */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Slots</h3>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <NumberField label="Slot length (min)" value={cfg.slotLengthMins} min={15} max={480} step={5} onChange={v => set('slotLengthMins', v)} />
          <NumberField label="Start every (min)" value={cfg.slotIntervalMins} min={5} max={480} step={5} onChange={v => set('slotIntervalMins', v)} />
          <NumberField label="Min notice (hours)" value={cfg.minNoticeHours} min={0} max={720} step={1} onChange={v => set('minNoticeHours', v)} />
          <NumberField label="Show next (days)" value={cfg.windowDays} min={1} max={120} step={1} onChange={v => set('windowDays', v)} />
        </div>

        <div className="mt-5 flex items-start justify-between gap-4 border-t border-slate-100 pt-4">
          <div>
            <p className="text-sm font-medium text-slate-800">Existing clients need approval</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {cfg.packageId
                ? 'On: a client’s pick becomes a request you confirm. Off: it books instantly.'
                : 'Single-session bookings by existing clients always book instantly. New people are reviewed when you accept their enquiry. Attach a package to require approval.'}
            </p>
          </div>
          {cfg.packageId ? (
            <Toggle checked={cfg.requiresApproval} onChange={v => set('requiresApproval', v)} label="Require approval" />
          ) : (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Always instant</span>
          )}
        </div>
      </section>

      {/* Page text */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Page text</h3>
        <label className="mt-4 block text-xs font-medium text-slate-700">Headline</label>
        <input
          value={cfg.headline ?? ''}
          onChange={e => set('headline', e.target.value)}
          placeholder={cfg.name}
          className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className="mt-4 block text-xs font-medium text-slate-700">Intro</label>
        <textarea
          value={cfg.intro ?? ''}
          onChange={e => set('intro', e.target.value)}
          rows={2}
          placeholder="Pick a time that suits and I'll confirm."
          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </section>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border md:px-5">
        <Button type="button" onClick={save} loading={saving}>Save changes</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> Saved</span>}
        <button onClick={deletePage} disabled={deleting} className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-600 disabled:opacity-50">
          <Trash2 className="h-4 w-4" /> Delete page
        </button>
      </div>
      </>
      )}

      {tab === 'automations' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <AutomationsSection pageId={page.id} initial={page.automations} />
        </section>
      )}
    </div>
  )
}

const TRIGGER_META: Record<AutomationTrigger, { label: string; verb: string; hasOffset: boolean }> = {
  ON_BOOKING: { label: 'Confirmation', verb: 'when someone books', hasOffset: false },
  BEFORE_SESSION: { label: 'Reminder', verb: 'before the session', hasOffset: true },
  AFTER_SESSION: { label: 'Follow-up', verb: 'after the session', hasOffset: true },
}

function AutomationsSection({ pageId, initial }: { pageId: string; initial: AutomationRow[] }) {
  const [items, setItems] = useState<AutomationRow[]>(initial)
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(trigger: AutomationTrigger) {
    setPicking(false)
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/trainer/booking-pages/${pageId}/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Could not add automation.'); return }
      setItems(a => [...a, body])
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/trainer/booking-pages/${pageId}/automations/${id}`, { method: 'DELETE' })
    if (res.ok) setItems(a => a.filter(x => x.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Automations</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Auto-send emails off this page. Use {'{name}'} {'{dog}'} {'{time}'} {'{business}'} as placeholders.
          </p>
        </div>
        <div className="relative">
          <Button type="button" size="sm" variant="secondary" onClick={() => setPicking(p => !p)} loading={adding}>
            <Plus className="h-4 w-4" /> Add
          </Button>
          {picking && (
            <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {(Object.keys(TRIGGER_META) as AutomationTrigger[]).map(t => (
                <button key={t} onClick={() => add(t)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-800">{TRIGGER_META[t].label}</span>
                  <span className="block text-xs text-slate-400">{TRIGGER_META[t].verb}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <Alert variant="error" className="mt-3">{error}</Alert>}

      {items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-400">No automations yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {items.map(a => (
            <AutomationCard
              key={a.id}
              pageId={pageId}
              automation={a}
              onChange={u => setItems(list => list.map(x => (x.id === u.id ? u : x)))}
              onDelete={() => remove(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AutomationCard({
  pageId,
  automation,
  onChange,
  onDelete,
}: {
  pageId: string
  automation: AutomationRow
  onChange: (a: AutomationRow) => void
  onDelete: () => void
}) {
  const [cfg, setCfg] = useState<AutomationRow>(automation)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const meta = TRIGGER_META[cfg.trigger]

  function set<K extends keyof AutomationRow>(key: K, value: AutomationRow[K]) {
    setCfg(c => ({ ...c, [key]: value }))
    setSaved(false)
  }

  async function patch(extra?: Partial<AutomationRow>) {
    const next = { ...cfg, ...extra }
    setCfg(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/trainer/booking-pages/${pageId}/automations/${cfg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next.enabled, offsetMinutes: next.offsetMinutes, subject: next.subject, body: next.body }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { onChange(body); setSaved(true) }
    } finally {
      setSaving(false)
    }
  }

  const offsetHours = Math.round(cfg.offsetMinutes / 60)

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{meta.label}</span>
        {meta.hasOffset ? (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <input
              type="number"
              min={0}
              max={720}
              value={offsetHours}
              onChange={e => set('offsetMinutes', Math.max(0, Number(e.target.value) || 0) * 60)}
              className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            hours {meta.verb}
          </span>
        ) : (
          <span className="text-xs text-slate-500">sent {meta.verb}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Toggle checked={cfg.enabled} onChange={v => patch({ enabled: v })} label="Enabled" />
          <button onClick={onDelete} title="Delete" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <input
        value={cfg.subject}
        onChange={e => set('subject', e.target.value)}
        placeholder="Subject"
        className="mt-3 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <textarea
        value={cfg.body}
        onChange={e => set('body', e.target.value)}
        rows={4}
        placeholder="Email body"
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" size="sm" onClick={() => patch()} loading={saving}>Save</Button>
        {saved && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // minHeight inline beats the unlayered global `button { min-height:44px }`.
      style={{ minHeight: 0 }}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${checked ? 'justify-end bg-blue-600' : 'justify-start bg-slate-300'}`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow" />
    </button>
  )
}

function NumberField({
  label, value, onChange, min, max, step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
