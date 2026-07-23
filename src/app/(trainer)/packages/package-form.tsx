'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { XeroAccountField } from '@/components/shared/xero-account-field'
import { RequirePaymentField } from '@/components/shared/require-payment-field'
import { BufferField } from '@/components/shared/buffer-field'
import { RecurrenceField } from '@/components/shared/recurrence-field'
import { cadenceFromRule } from '@/lib/recurrence'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { User, Users } from 'lucide-react'
import { PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/feature-flags'

export type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

const COLOR_OPTIONS: { id: PackageColor; label: string; swatch: string }[] = [
  { id: 'blue',    label: 'Blue',    swatch: 'bg-blue-500' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'amber',   label: 'Amber',   swatch: 'bg-amber-500' },
  { id: 'rose',    label: 'Rose',    swatch: 'bg-rose-500' },
  { id: 'purple',  label: 'Purple',  swatch: 'bg-purple-500' },
  { id: 'orange',  label: 'Orange',  swatch: 'bg-orange-500' },
  { id: 'teal',    label: 'Teal',    swatch: 'bg-teal-500' },
  { id: 'indigo',  label: 'Indigo',  swatch: 'bg-indigo-500' },
  { id: 'pink',    label: 'Pink',    swatch: 'bg-pink-500' },
  { id: 'cyan',    label: 'Cyan',    swatch: 'bg-cyan-500' },
]

export interface PkgRow {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  // "Gap before the next session" — optional so older loaders that don't select
  // it still satisfy the type; the form defaults it to 0.
  bufferMins?: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  specialPriceCents: number | null
  color: PackageColor | null
  defaultSessionFormId: string | null
  requireSessionNotes: boolean
  // Group-class config (optional so an older loader that doesn't select
  // them still satisfies the type — the form defaults them).
  isGroup?: boolean
  capacity?: number | null
  allowDropIn?: boolean
  dropInPriceCents?: number | null
  recurrenceRule?: string | null
  allowWaitlist?: boolean
  publicEnrollment?: boolean
  clientSelfBook?: boolean
  selfBookRequiresApproval?: boolean
  xeroAccountCode?: string | null
  requirePayment?: boolean | null
  assignments: number
}

export interface SessionFormOption {
  id: string
  name: string
}

// We collect price as a decimal string from the user (e.g. "120" or "120.50")
// then convert to cents server-side. This keeps the input UX natural without
// pulling in a money/decimal library.
const formSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  // 0 = ongoing — the trainer picks an end date when assigning the package.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  price: z.string().optional(),
  specialPrice: z.string().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
})

export function dollarsToCents(s: string | undefined): number | null {
  if (!s || !s.trim()) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

export function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

type FormValues = z.infer<typeof formSchema>

/**
 * The shared package create/edit form. Used on the create page (/packages/new)
 * and the edit page (/packages/[packageId]/edit). Lays its fields out in a
 * responsive two-column grid (short inputs pair up; description, toggles and
 * the colour picker span both). Renders the fields + submit/cancel actions;
 * the surrounding page chrome is the caller's concern.
 */
export function PackageForm({
  existing,
  sessionForms,
  onCancel,
  onSaved,
}: {
  existing: PkgRow | null
  sessionForms: SessionFormOption[]
  onCancel: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState<PackageColor | null>(existing?.color ?? null)
  const [defaultSessionFormId, setDefaultSessionFormId] = useState<string | null>(existing?.defaultSessionFormId ?? null)
  const [requireSessionNotes, setRequireSessionNotes] = useState<boolean>(existing?.requireSessionNotes ?? true)
  // Turnaround gap blocked out after each session of this package.
  const [bufferMins, setBufferMins] = useState<number>(existing?.bufferMins ?? 0)
  // Group-class config — extra state (not RHF fields).
  const [isGroup, setIsGroup] = useState<boolean>(existing?.isGroup ?? false)
  const [capacity, setCapacity] = useState<string>(
    existing?.capacity != null ? String(existing.capacity) : '',
  )
  const [allowDropIn, setAllowDropIn] = useState<boolean>(existing?.allowDropIn ?? false)
  const [dropInPrice, setDropInPrice] = useState<string>(centsToDollars(existing?.dropInPriceCents ?? null))
  const [recurrenceRule, setRecurrenceRule] = useState<string>(existing?.recurrenceRule ?? '')
  const [allowWaitlist, setAllowWaitlist] = useState<boolean>(existing?.allowWaitlist ?? false)
  const [publicEnrollment, setPublicEnrollment] = useState<boolean>(existing?.publicEnrollment ?? false)
  // Client self-booking (independent of group classes).
  const [xeroAccountCode, setXeroAccountCode] = useState<string>(existing?.xeroAccountCode ?? '')
  const [xeroActive, setXeroActive] = useState(false)
  const [clientSelfBook, setClientSelfBook] = useState<boolean>(existing?.clientSelfBook ?? false)
  const [selfBookRequiresApproval, setSelfBookRequiresApproval] = useState<boolean>(existing?.selfBookRequiresApproval ?? true)
  const [requirePayment, setRequirePayment] = useState<boolean | null>(existing?.requirePayment ?? null)
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          sessionCount: existing.sessionCount,
          weeksBetween: existing.weeksBetween,
          durationMins: existing.durationMins,
          sessionType: existing.sessionType,
          price: centsToDollars(existing.priceCents),
          specialPrice: centsToDollars(existing.specialPriceCents),
        }
      : { sessionCount: 3, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', price: '', specialPrice: '' },
  })

  // A one-off package — a single session, no cadence. "Weeks between" is moot.
  const oneOff = Number(watch('sessionCount')) === 1

  // Convert 1:1 ↔ group. Its own request because the server refuses the change
  // while the package is in use and explains why — a message worth showing
  // rather than folding into a generic save failure.
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  async function handleConvert() {
    if (!existing || converting) return
    const target = !isGroup
    const msg = target
      ? 'Convert this into a group class? It will run as cohorts with a roster and capacity.'
      : 'Convert this back into a 1:1 package? Capacity, waitlist and drop-in settings will be cleared.'
    if (!confirm(msg)) return
    setConverting(true)
    setConvertError(null)
    try {
      const res = await fetch(`/api/packages/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isGroup: target }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null
        setConvertError(typeof body?.error === 'string' ? body.error : 'Could not convert this package.')
        return
      }
      setIsGroup(target)
      if (!target) { setCapacity(''); setAllowDropIn(false); setAllowWaitlist(false); setPublicEnrollment(false) }
    } finally {
      setConverting(false)
    }
  }

  async function onSubmit(values: FormValues) {
    setError(null)
    // When Xero is connected with a curated shortlist, the income account is
    // required so every package/class posts to a real Xero account.
    if (xeroActive && !xeroAccountCode) {
      setError('Choose a Xero income account for this package.')
      return
    }
    const url = existing ? `/api/packages/${existing.id}` : '/api/packages'
    const method = existing ? 'PATCH' : 'POST'
    // Convert the dollar-string price fields into cents before sending; the
    // server stores cents to dodge floating-point math.
    const { price, specialPrice, ...rest } = values
    // A group/drop-in class is scheduled by its recurrence, so its cadence is
    // DERIVED from the rule (the sessionCount/weeks inputs are hidden for it).
    // A 1:1 package keeps the typed values.
    const groupCadence = isGroup && recurrenceRule ? cadenceFromRule(recurrenceRule) : null
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rest,
        sessionCount: groupCadence ? groupCadence.sessionCount : values.sessionCount,
        // A single-session package has no cadence — store 0 rather than
        // whatever was last typed into the (now hidden) weeks field.
        weeksBetween: groupCadence
          ? groupCadence.weeksBetween
          : Number(values.sessionCount) === 1 ? 0 : values.weeksBetween,
        description: values.description || null,
        priceCents: dollarsToCents(price),
        specialPriceCents: dollarsToCents(specialPrice),
        bufferMins,
        color,
        defaultSessionFormId,
        requireSessionNotes,
        isGroup,
        capacity: isGroup && capacity.trim() ? Math.max(0, Math.floor(Number(capacity))) : null,
        allowDropIn: isGroup && allowDropIn,
        dropInPriceCents: isGroup && allowDropIn ? dollarsToCents(dropInPrice) : null,
        recurrenceRule: isGroup && recurrenceRule ? recurrenceRule : null,
        allowWaitlist: isGroup && allowWaitlist,
        publicEnrollment: isGroup && publicEnrollment,
        clientSelfBook,
        selfBookRequiresApproval,
        xeroAccountCode: xeroAccountCode || null,
        requirePayment,
      }),
    })
    if (!res.ok) {
      // The convert-while-in-use refusal (409) explains itself — show that
      // rather than a generic failure the trainer can't act on.
      const body = await res.json().catch(() => null) as { error?: unknown } | null
      setError(typeof body?.error === 'string' ? body.error : 'Failed to save.')
      return
    }
    const saved = await res.json()
    onSaved(
      {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        sessionCount: saved.sessionCount,
        weeksBetween: saved.weeksBetween,
        durationMins: saved.durationMins,
        bufferMins: saved.bufferMins ?? 0,
        sessionType: saved.sessionType,
        priceCents: saved.priceCents ?? null,
        specialPriceCents: saved.specialPriceCents ?? null,
        color: saved.color ?? null,
        defaultSessionFormId: saved.defaultSessionFormId ?? null,
        requireSessionNotes: saved.requireSessionNotes ?? true,
        isGroup: saved.isGroup ?? false,
        capacity: saved.capacity ?? null,
        allowDropIn: saved.allowDropIn ?? false,
        dropInPriceCents: saved.dropInPriceCents ?? null,
        recurrenceRule: saved.recurrenceRule ?? null,
        allowWaitlist: saved.allowWaitlist ?? false,
        publicEnrollment: saved.publicEnrollment ?? false,
        clientSelfBook: saved.clientSelfBook ?? false,
        selfBookRequiresApproval: saved.selfBookRequiresApproval ?? true,
        xeroAccountCode: saved.xeroAccountCode ?? null,
        requirePayment: saved.requirePayment ?? null,
        assignments: existing?.assignments ?? 0,
      },
      !existing
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
      {error && <div className="md:col-span-2"><Alert variant="error">{error}</Alert></div>}

      {/* ── Step 1 · details ───────────────────────────────────────── */}
      <SectionHeading step={1} title="Details" />

      <div className="md:col-span-2">
        <Input label="Name" placeholder="e.g. Puppy Foundations · 6 sessions" error={errors.name?.message} {...register('name')} />
      </div>

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Description (optional)</label>
        <textarea
          {...register('description')}
          rows={3}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Kind sits inside step 1 — name it, then say what it is. */}
      <div className="md:col-span-2">
        <p className="text-sm font-medium text-slate-700 mb-2">What are you setting up?</p>
      </div>

      {existing ? (
        // Editing: changing kind is a deliberate CONVERSION (it moves the
        // package between two halves of the system and is refused once it's in
        // use), so it keeps its own button + round-trip, separate from Save.
        <div className="md:col-span-2 rounded-xl border border-slate-200 px-3.5 py-3 flex items-start gap-3">
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{isGroup ? 'Group class' : '1:1 package'}</span>
            <span className="block text-xs text-slate-400 mt-0.5">
              {isGroup
                ? 'Runs as cohorts — one shared schedule, many clients, a roster and capacity.'
                : 'Assigned to one client at a time, with their own sessions.'}
            </span>
            {convertError && <span className="block text-[11px] font-medium mt-1.5 text-red-600">{convertError}</span>}
          </span>
          <button
            type="button"
            onClick={handleConvert}
            disabled={converting}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {converting ? 'Converting…' : isGroup ? 'Convert to 1:1 package' : 'Convert to group class'}
          </button>
        </div>
      ) : (
        // Creating: choose what this IS. Drop-in is a group class that takes
        // single-session bookings, so it presets isGroup + allowDropIn.
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {([
            { key: 'onetoone', icon: User, label: '1:1 package', desc: 'One-on-one sessions you assign to a single client, on their own schedule.', on: () => { setIsGroup(false) } },
            { key: 'group', icon: Users, label: 'Group class', desc: 'A cohort shares one schedule and roster and enrols for the whole course.', on: () => { setIsGroup(true); setAllowDropIn(false) } },
            { key: 'dropin', icon: Users, label: 'Drop-in classes', desc: 'People join one session at a time and pay per session — great for casual regulars.', on: () => { setIsGroup(true); setAllowDropIn(true) } },
          ] as const).map(o => {
            const active = (o.key === 'onetoone' && !isGroup) || (o.key === 'group' && isGroup && !allowDropIn) || (o.key === 'dropin' && isGroup && allowDropIn)
            const Icon = o.icon
            return (
              <button
                key={o.key}
                type="button"
                onClick={o.on}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:border-blue-200'}`}
              >
                <Icon className={`h-5 w-5 mb-2 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className={`block text-sm font-semibold ${active ? 'text-blue-900' : 'text-slate-800'}`}>{o.label}</span>
                <span className="block text-xs text-slate-500 mt-1 leading-snug">{o.desc}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Step 2 · sessions & schedule ───────────────────────────── */}
      <SectionHeading step={2} title="Sessions & schedule" />

      {/* One schedule definition, not two. A group class repeats on a
          recurrence (how often + when it ends); a 1:1 package is a run of N
          sessions every W weeks. Showing both was the redundancy. The 1:1
          fields stay registered when hidden so their values still submit. */}
      {isGroup ? (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">How often does it run?</label>
          <RecurrenceField value={recurrenceRule} onChange={setRecurrenceRule} />
          <div className="hidden">
            <input type="number" {...register('sessionCount', { valueAsNumber: true })} />
            <input type="number" {...register('weeksBetween', { valueAsNumber: true })} />
          </div>
        </div>
      ) : (
        <>
          <div>
            <Input
              label="Number of sessions"
              type="number"
              error={errors.sessionCount?.message}
              {...register('sessionCount', { valueAsNumber: true })}
            />
            <p className="text-[11px] text-slate-400 mt-1">0 = ongoing (you set an end date when assigning) · 1 = one-off (single session)</p>
          </div>
          {/* A one-off has nothing to space out, so the field goes away — but via
              `invisible`, not by unmounting: visibility:hidden keeps the grid cell
              (nothing below jumps) while removing it from view AND from the tab
              order. It stays registered, and onSubmit forces 0 so the stored
              cadence matches reality. */}
          <div className={oneOff ? 'invisible' : undefined} aria-hidden={oneOff}>
            <Input
              label="Weeks between"
              type="number"
              error={errors.weeksBetween?.message}
              {...register('weeksBetween', { valueAsNumber: true })}
            />
          </div>
        </>
      )}

      <Input
        label="Default duration (mins)"
        type="number"
        error={errors.durationMins?.message}
        {...register('durationMins', { valueAsNumber: true })}
      />

      {/* Turnaround gap after each session — travel, clean-up, reset. Blocked
          out on the calendar so nothing can be booked into it. */}
      <BufferField id="package-buffer" value={bufferMins} onChange={setBufferMins} />

      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Session type</label>
        <div className="flex gap-2">
          {(['IN_PERSON', 'VIRTUAL'] as const).map(t => (
            <label key={t} className="flex-1">
              <input type="radio" value={t} className="sr-only peer" {...register('sessionType')} />
              <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                {t === 'IN_PERSON' ? '📍 In person' : '💻 Virtual'}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Capacity is a class-only limit, so it sits with the schedule. */}
      {isGroup && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity (optional)</label>
          <input
            type="number"
            min={0}
            value={capacity}
            onChange={e => setCapacity(e.target.value)}
            placeholder="Leave blank for unlimited"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">Max in the room per session. A run can override this.</p>
        </div>
      )}

      {/* Drop-in options live with the schedule — they're about how people join
          a class's sessions. Drop-in price stays here (not in Pricing) so it
          sits with its on/off switch. */}
      {isGroup && (
        <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={allowDropIn} onChange={e => setAllowDropIn(e.target.checked)} className="h-4 w-4 mt-0.5" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-700">Allow drop-ins</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Clients can book a single session on its own, at the per-session price below.</span>
            </span>
          </label>

          {allowDropIn && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Drop-in price per session</label>
              <input
                type="text"
                inputMode="decimal"
                value={dropInPrice}
                onChange={e => setDropInPrice(e.target.value)}
                placeholder="30"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {PUBLIC_CLASS_ENROLLMENT_ENABLED && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={publicEnrollment} onChange={e => setPublicEnrollment(e.target.checked)} className="h-4 w-4 mt-0.5" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-700">Let clients self-enrol from your embed form</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">Open runs show publicly; requests arrive as enquiries for you to accept.</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* ── Step 3 · pricing ───────────────────────────────────────── */}
      <SectionHeading step={3} title="Pricing" hint={isGroup ? 'The full-course price. Drop-in price is set above.' : 'Leave blank for no set price.'} />

      {/* Leave price blank for "no price set". The special price is independent
          and only shown when populated. */}
      <Input
        label="Price"
        type="text"
        inputMode="decimal"
        placeholder="120"
        {...register('price')}
      />
      <Input
        label="Special price (optional)"
        type="text"
        inputMode="decimal"
        placeholder="—"
        {...register('specialPrice')}
      />

      {/* Sits with the price — required when Xero is connected so revenue posts
          to the right account. Renders nothing when Xero isn't set up. */}
      <div className="md:col-span-2">
        <XeroAccountField value={xeroAccountCode} onChange={setXeroAccountCode} required onActiveChange={setXeroActive} />
      </div>

      {/* Whether clients must pay up front to book this package. */}
      <div className="md:col-span-2">
        <RequirePaymentField value={requirePayment} onChange={setRequirePayment} />
      </div>

      {/* ── Step 4 · settings ──────────────────────────────────────── */}
      <SectionHeading step={4} title="Settings" />

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Default session form</label>
        <p className="text-[11px] text-slate-400 mb-1.5">
          Auto-attached to each new session in this package. Trainer can still swap it on the session.
        </p>
        <select
          value={defaultSessionFormId ?? ''}
          onChange={e => setDefaultSessionFormId(e.target.value || null)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">None</option>
          {sessionForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={requireSessionNotes}
          onChange={e => setRequireSessionNotes(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Send a follow-up reminder for session notes</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Sends a push near the end of each session in this package nudging you to write notes. Turn off for drop-in classes or anything that doesn&apos;t need a follow-up.
          </span>
        </span>
      </label>

      {/* ─── Client self-booking ─────────────────────────────────── */}
      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={clientSelfBook}
          onChange={e => setClientSelfBook(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Let clients self-book this from their availability tab</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Clients pick a start time from your real openings; the rest auto-place on the package cadence.
          </span>
        </span>
      </label>

      {clientSelfBook && (
        <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selfBookRequiresApproval}
            onChange={e => setSelfBookRequiresApproval(e.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Require my approval before it&apos;s booked</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              On: the client&apos;s pick is a request you confirm. Off: it books instantly onto your calendar.
            </span>
          </span>
        </label>
      )}

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Schedule colour</label>
        <p className="text-[11px] text-slate-400 mb-1.5">Sessions assigned to this package will use this colour on the calendar. Leave blank to keep the default status colour.</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setColor(null)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
              color === null
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Default
          </button>
          {COLOR_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setColor(opt.id)}
              aria-label={opt.label}
              className={`h-7 w-7 rounded-full border-2 transition-all ${opt.swatch} ${color === opt.id ? 'border-slate-900 ring-2 ring-slate-300' : 'border-white shadow-sm hover:scale-110'}`}
            />
          ))}
        </div>
      </div>

      <div className="md:col-span-2 flex gap-2 pt-2">
        <Button type="submit" loading={isSubmitting}>{existing ? 'Save changes' : 'Create package'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

/** A numbered section divider that spans the form's 2-col grid — breaks the
 * long form into clear, ordered steps without turning it into a multi-page
 * wizard (the whole thing still saves in one go). */
function SectionHeading({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <div className="md:col-span-2 flex items-center gap-3 pt-3 first:pt-0 border-t border-slate-100 first:border-0 mt-1 first:mt-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold">{step}</span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900 leading-tight">{title}</h2>
        {hint && <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}
