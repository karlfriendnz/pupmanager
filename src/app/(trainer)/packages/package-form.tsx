'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { XeroAccountField } from '@/components/shared/xero-account-field'
import { RequirePaymentField } from '@/components/shared/require-payment-field'
import { BufferField } from '@/components/shared/buffer-field'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'
import { ImageUploadButton } from '@/components/image-uploader'
import { DateTimePicker } from '@/components/shared/date-time-picker'
import { AddLocationModal } from '@/components/shared/add-location-modal'
import { SessionSlotsEditor, newSlot, type SessionSlot } from '@/components/shared/session-slots'
import { TicketTiersEditor, newTier, type TicketTier } from '@/components/shared/ticket-tiers'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { User, Users, CalendarDays, X, ChevronDown, Check, Plus } from 'lucide-react'
import { PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/feature-flags'

export type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

// The four things a trainer can create. A UI-level discriminator over the
// persisted Package flags (isGroup / allowDropIn / sessionCount / recurrence).
type OfferingKind = 'onetoone' | 'group' | 'dropin' | 'oneoff'

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
  region,
  initialKind,
  onCancel,
  onSaved,
}: {
  existing: PkgRow | null
  sessionForms: SessionFormOption[]
  /** ISO country code for localising Google address suggestions. */
  region?: string
  /** Pre-select the kind when creating (from the "+" menu on a specific page). */
  initialKind?: OfferingKind
  onCancel: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  // Editing an existing offering drops the wizard chrome: no step numbers, no
  // "What are you setting up?" chooser — just the fields, plus Delete/Clone.
  const stepped = !existing
  const [deleting, setDeleting] = useState(false)
  const [cloning, setCloning] = useState(false)
  async function handleDelete() {
    if (!existing || deleting) return
    if (!confirm('Delete this offering? This can’t be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/packages/${existing.id}`, { method: 'DELETE' })
    if (res.ok) window.location.href = '/packages'
    else { setError('Could not delete this offering.'); setDeleting(false) }
  }
  async function handleClone() {
    if (!existing || cloning) return
    setCloning(true)
    const res = await fetch(`/api/packages/${existing.id}/clone`, { method: 'POST' })
    const body = await res.json().catch(() => null) as { id?: string } | null
    if (res.ok && body?.id) window.location.href = `/packages/${body.id}/edit`
    else { setError('Could not clone this offering.'); setCloning(false) }
  }
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState<PackageColor | null>(existing?.color ?? null)
  const [defaultSessionFormId, setDefaultSessionFormId] = useState<string | null>(existing?.defaultSessionFormId ?? null)
  const [requireSessionNotes, setRequireSessionNotes] = useState<boolean>(existing?.requireSessionNotes ?? true)
  // Turnaround gap blocked out after each session of this package.
  const [bufferMins, setBufferMins] = useState<number>(existing?.bufferMins ?? 0)
  // Group-class config — extra state (not RHF fields). New offerings can be
  // pre-set to a kind via the "+" menu (initialKind).
  const [isGroup, setIsGroup] = useState<boolean>(existing?.isGroup ?? (initialKind != null && initialKind !== 'onetoone'))
  const [capacity, setCapacity] = useState<string>(
    existing?.capacity != null ? String(existing.capacity) : '',
  )
  const [allowDropIn, setAllowDropIn] = useState<boolean>(existing?.allowDropIn ?? (initialKind === 'dropin'))
  const [dropInPrice, setDropInPrice] = useState<string>(centsToDollars(existing?.dropInPriceCents ?? null))
  const [recurrenceRule, setRecurrenceRule] = useState<string>(existing?.recurrenceRule ?? '')
  // Class-only scheduling (lives on a ClassRun today — see the audit). Shown for
  // the class/drop-in/one-off kinds so this one form covers "when / where / who".
  // NOT yet wired to run creation — captured for review while we shape the form.
  const [startAt, setStartAt] = useState<Date | null>(null)
  const [location, setLocation] = useState<string>('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [scheduleNote, setScheduleNote] = useState<string>('')
  // Drop-in classes define their weekly slots individually (day/time/location).
  const [slots, setSlots] = useState<SessionSlot[]>([newSlot()])
  // Join link for a virtual session (Zoom/Meet); only when session type = Virtual.
  const [virtualLink, setVirtualLink] = useState<string>('')
  // Simple ticket tiers for a one-off event (name + price + capacity).
  const [tickets, setTickets] = useState<TicketTier[]>([newTier()])
  // Who delivers this — assignable for every kind. Fetched client-side (the
  // team endpoint returns membership ids). NOT yet wired to persistence.
  const [team, setTeam] = useState<{ id: string; name: string | null; title: string | null }[]>([])
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [assignOpen, setAssignOpen] = useState(false)
  // Saved locations to pick from (built in Settings → Locations). '' = none,
  // a location id = that saved place, '__custom' = type a one-off address.
  const [savedLocations, setSavedLocations] = useState<{ id: string; name: string; address: string | null }[]>([])
  const [locationChoice, setLocationChoice] = useState<string>('')
  const [addLocationOpen, setAddLocationOpen] = useState(false)
  useEffect(() => {
    let off = false
    fetch('/api/trainer/locations')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { locations?: { id: string; name: string; address: string | null }[] } | null) => {
        if (!off && d?.locations) setSavedLocations(d.locations.map(l => ({ id: l.id, name: l.name, address: l.address })))
      })
      .catch(() => {})
    return () => { off = true }
  }, [])
  useEffect(() => {
    let off = false
    fetch('/api/trainer/team')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { members?: { id: string; name: string | null; title: string | null; status?: string }[] } | null) => {
        if (!off && d?.members) setTeam(d.members.filter(m => m.status === 'ACTIVE').map(m => ({ id: m.id, name: m.name, title: m.title })))
      })
      .catch(() => {})
    return () => { off = true }
  }, [])
  // The offering kind drives the card selection + which schedule fields show.
  // It's a UI discriminator over the persisted flags: a one-off event is a
  // group with a single session and no recurrence.
  const [kind, setKind] = useState<OfferingKind>(() => {
    if (!existing) return initialKind ?? 'onetoone'
    if (!existing.isGroup) return 'onetoone'
    if (existing.allowDropIn) return 'dropin'
    if (existing.sessionCount === 1 && !existing.recurrenceRule) return 'oneoff'
    return 'group'
  })
  function selectKind(k: OfferingKind) {
    setKind(k)
    setIsGroup(k !== 'onetoone')
    setAllowDropIn(k === 'dropin')
    if (k === 'oneoff') setRecurrenceRule('')
  }
  // Add-mode wizard: one section per step (a drop-in has no pricing step).
  // Editing shows every section on one page (stepped === false).
  const stepKeys: string[] = ['start', 'schedule', ...(kind === 'dropin' ? [] : ['pricing']), 'settings']
  const [wstep, setWstep] = useState(0)
  const clampedStep = Math.min(wstep, stepKeys.length - 1)
  const currentKey = stepKeys[clampedStep]
  const onSection = (k: string) => !stepped || currentKey === k
  const isLastStep = clampedStep === stepKeys.length - 1
  const [allowWaitlist, setAllowWaitlist] = useState<boolean>(existing?.allowWaitlist ?? false)
  const [publicEnrollment, setPublicEnrollment] = useState<boolean>(existing?.publicEnrollment ?? false)
  // Client self-booking (independent of group classes).
  const [xeroAccountCode, setXeroAccountCode] = useState<string>(existing?.xeroAccountCode ?? '')
  const [xeroActive, setXeroActive] = useState(false)
  const [clientSelfBook, setClientSelfBook] = useState<boolean>(existing?.clientSelfBook ?? false)
  const [selfBookRequiresApproval, setSelfBookRequiresApproval] = useState<boolean>(existing?.selfBookRequiresApproval ?? true)
  const [requirePayment, setRequirePayment] = useState<boolean | null>(existing?.requirePayment ?? null)
  const { register, handleSubmit, watch, trigger, formState: { errors, isSubmitting } } = useForm<FormValues>({
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
      : { sessionCount: 1, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', price: '', specialPrice: '' },
  })

  // A one-off package — a single session, no cadence. "Weeks between" is moot.
  const oneOff = Number(watch('sessionCount')) === 1

  // Convert 1:1 ↔ group. Its own request because the server refuses the change
  // while the package is in use and explains why — a message worth showing
  // rather than folding into a generic save failure.
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
    // One cadence model for all kinds: N sessions every W weeks (a one-off
    // event is just 1 session, no cadence).
    const sessionCount = kind === 'oneoff' ? 1 : values.sessionCount
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rest,
        sessionCount,
        // A single-session offering has no cadence — store 0 rather than
        // whatever was last typed into the (now hidden) weeks field.
        weeksBetween: Number(sessionCount) === 1 ? 0 : values.weeksBetween,
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

      {addLocationOpen && (
        <AddLocationModal
          region={region}
          onClose={() => setAddLocationOpen(false)}
          onCreated={loc => {
            setSavedLocations(prev => [...prev, { id: loc.id, name: loc.name, address: loc.address }])
            setLocationChoice(loc.id)
            setLocation(loc.address || loc.name)
            setAddLocationOpen(false)
          }}
        />
      )}

      {/* Wizard progress — only when adding. */}
      {stepped && (
        <div className="md:col-span-2 flex items-center gap-1.5 mb-1">
          {stepKeys.map((k, i) => (
            <div key={k} className="flex flex-1 items-center gap-1.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < clampedStep ? 'bg-blue-600 text-white' : i === clampedStep ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</span>
              {i < stepKeys.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < clampedStep ? 'bg-blue-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* ── Start: name + what ───────────────────────────────────── */}
      {onSection('start') && (
      <>
      {/* Name + description sit at the top of the step. */}
      {!stepped && <SectionHeading title="Details" />}

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

      {/* Kind chooser — shown when adding; hidden when editing (locked in). */}
      {stepped && (
      <>
      <div className="md:col-span-2">
        <p className="text-sm font-medium text-slate-700 mb-2 mt-1">What are you setting up?</p>
      </div>

      {/* Choose what this IS. Drop-in is a group class that takes single-session
          bookings, so it presets isGroup + allowDropIn. */}
      <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {([
            { key: 'onetoone', icon: User, label: '1-on-1 session', desc: 'One-on-one sessions you book with a single client — grooming, a training session, a consult.' },
            { key: 'group', icon: Users, label: 'Group class', desc: 'A cohort shares one schedule and roster and signs up for the whole course.' },
            { key: 'dropin', icon: Users, label: 'Drop-in sessions', desc: 'People join one session at a time and pay per session — great for casual regulars.' },
            { key: 'oneoff', icon: CalendarDays, label: 'One-off event', desc: 'A single event on one date — a workshop, seminar or meet-up people sign up to.' },
          ] as const).map(o => {
            const active = kind === o.key
            const Icon = o.icon
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => selectKind(o.key)}
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
      </>
      )}
      </>
      )}

      {/* ── Sessions & schedule ──────────────────────────────────── */}
      {onSection('schedule') && (
      <>
      <SectionHeading title="Sessions & schedule" />

      {/* One schedule model everywhere: a run of N sessions every W weeks.
          1:1, group and drop-in all use it; only a one-off event has no cadence. */}
      {kind === 'oneoff' ? (
        // A single event has no cadence — its date & time are set below.
        // Keep the RHF fields registered (submit forces 1 session).
        <div className="md:col-span-2">
          <p className="text-xs text-slate-500 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            A single event on one date. Set its date &amp; time below.
          </p>
          <div className="hidden">
            <input type="number" {...register('sessionCount', { valueAsNumber: true })} />
            <input type="number" {...register('weeksBetween', { valueAsNumber: true })} />
          </div>
        </div>
      ) : kind === 'dropin' ? (
        // Drop-in classes are a set of self-contained session cards — each with
        // its own start date, time, duration, gap, capacity, location and
        // recurrence. RHF cadence fields kept registered (unused for this kind).
        <div className="md:col-span-2">
          <SessionSlotsEditor
            value={slots}
            onChange={setSlots}
            locations={savedLocations.map(l => ({ id: l.id, name: l.name }))}
            team={team}
            region={region}
            onLocationCreated={loc => setSavedLocations(prev => [...prev, { id: loc.id, name: loc.name, address: loc.address }])}
          />
          <div className="hidden">
            <input type="number" {...register('sessionCount', { valueAsNumber: true })} />
            <input type="number" {...register('weeksBetween', { valueAsNumber: true })} />
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Number of sessions</label>
            <select
              {...register('sessionCount', { valueAsNumber: true })}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={1}>One-off (single session)</option>
              {Array.from({ length: 19 }, (_, i) => i + 2).map(n => (
                <option key={n} value={n}>{n} sessions</option>
              ))}
              <option value={0}>Ongoing (no fixed end)</option>
            </select>
          </div>
          {/* Weeks-between only matters once there's more than one session, so it
              appears the moment they pick anything other than One-off. `invisible`
              (not unmounting) keeps the grid cell so nothing below jumps, and the
              field stays registered so its value still submits. */}
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

      {/* When / where / cover — unique to a scheduled class (these live on the
          ClassRun today). Shown for the class kinds so this one form covers the
          whole thing. Recurring classes call it the FIRST session's time. */}
      {/* Drop-in keeps these inside its session box (above); other class kinds
          show them here. */}
      {kind !== 'onetoone' && kind !== 'dropin' && (
        <div className="md:col-span-2">
          {/* One-off shows its own Date/Time sub-labels (stacked); the group's
              first-session field keeps the single label. */}
          {kind !== 'oneoff' && (
            <label className="text-sm font-medium text-slate-700 block mb-1.5">First session (date &amp; time)</label>
          )}
          <DateTimePicker value={startAt} onChange={setStartAt} stacked={kind === 'oneoff'} />
        </div>
      )}

      {kind !== 'dropin' && (
        <Input
          label="Duration (mins)"
          type="number"
          error={errors.durationMins?.message}
          {...register('durationMins', { valueAsNumber: true })}
        />
      )}

      {/* Turnaround gap after each session — travel, clean-up, reset. Blocked
          out on the calendar so nothing can be booked into it. */}
      {kind !== 'dropin' && (
        <BufferField id="package-buffer" value={bufferMins} onChange={setBufferMins} />
      )}

      {/* Drop-in classes carry their own per-session details in the cards, so
          the class-level type / capacity / location are hidden for them. */}
      {kind !== 'dropin' && (
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
      )}

      {/* Join link — a virtual session needs somewhere to meet online. */}
      {watch('sessionType') === 'VIRTUAL' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Virtual session link</label>
          <input
            type="url"
            value={virtualLink}
            onChange={e => setVirtualLink(e.target.value)}
            placeholder="https://zoom.us/j/… or Google Meet link"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Capacity is a class-only limit, so it sits with the schedule. */}
      {isGroup && kind !== 'dropin' && (
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

      {/* Self-enrol option (feature-flagged) for the drop-in kind. The old
          "Drop-in price per session" field was removed on request. */}
      {kind === 'dropin' && PUBLIC_CLASS_ENROLLMENT_ENABLED && (
        <label className="md:col-span-2 flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 px-3 py-2.5">
          <input type="checkbox" checked={publicEnrollment} onChange={e => setPublicEnrollment(e.target.checked)} className="h-4 w-4 mt-0.5" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Let clients self-enrol from your embed form</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">Open runs show publicly; requests arrive as enquiries for you to accept.</span>
          </span>
        </label>
      )}

      {/* Where it meets — same design as the drop-in session location: a
          dropdown of saved locations + a "+" that opens the add-location popup. */}
      {kind !== 'onetoone' && kind !== 'dropin' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Location <span className="text-slate-400">(optional)</span></label>
          <div className="flex gap-2">
            <select
              value={locationChoice}
              onChange={e => {
                const v = e.target.value
                setLocationChoice(v)
                const loc = savedLocations.find(l => l.id === v)
                setLocation(loc?.address || loc?.name || '')
              }}
              className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose location…</option>
              {savedLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setAddLocationOpen(true)}
              title="Add a new location"
              aria-label="Add a new location"
              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/* ── Pricing — a drop-in prices per session, so no pricing step. ── */}
      {kind !== 'dropin' && onSection('pricing') && (
      <>
      <SectionHeading title="Pricing" hint={
        kind === 'oneoff' ? 'What it costs to attend the event.'
          : kind === 'group' ? 'The full-course price.'
          : 'Leave blank for no set price.'
      } />

      {/* A one-off event sells tickets (name + price + capacity); everything
          else has a single price (+ optional special). RHF price fields stay
          registered for events so their values still submit harmlessly. */}
      {kind === 'oneoff' ? (
        <>
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Tickets</label>
            <TicketTiersEditor value={tickets} onChange={setTickets} />
          </div>
          <div className="hidden">
            <input {...register('price')} />
            <input {...register('specialPrice')} />
          </div>
        </>
      ) : (
        <>
          {/* Leave price blank for "no price set". The special price is
              independent and only shown when populated. */}
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
        </>
      )}

      {/* Sits with the price — required when Xero is connected so revenue posts
          to the right account. Renders nothing when Xero isn't set up. */}
      <div className="md:col-span-2">
        <XeroAccountField value={xeroAccountCode} onChange={setXeroAccountCode} required onActiveChange={setXeroActive} />
      </div>

      {/* Whether clients must pay up front to book this package. */}
      <div className="md:col-span-2">
        <RequirePaymentField value={requirePayment} onChange={setRequirePayment} />
      </div>
      </>
      )}

      {/* ── Settings ─────────────────────────────────────────────── */}
      {onSection('settings') && (
      <>
      <SectionHeading title="Settings" />

      {/* Who delivers it — assignable per kind (drop-in assigns per session). */}
      {team.length > 1 && kind !== 'dropin' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Assigned to <span className="text-slate-400">(optional)</span></label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAssignOpen(o => !o)}
              className="h-11 w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className={`flex-1 truncate ${assignedIds.length ? 'text-slate-900' : 'text-slate-400'}`}>
                {assignedIds.length === 0
                  ? 'Anyone / unassigned'
                  : assignedIds.length === 1
                    ? (team.find(m => m.id === assignedIds[0])?.name ?? 'Team member')
                    : `${assignedIds.length} team members`}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
            {assignOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAssignOpen(false)} />
                <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10">
                  {team.map(m => {
                    const on = assignedIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedIds(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="text-slate-800">{m.name ?? 'Team member'}{m.title ? <span className="text-slate-400"> · {m.title}</span> : null}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

      {/* Image / icon — every kind, on the last step per request. */}
      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Image <span className="text-slate-400">(optional)</span></label>
        {imageUrl ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-24 w-full max-w-[16rem] rounded-xl object-cover border border-slate-200" />
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <ImageUploadButton onUploaded={urls => { if (urls[0]) setImageUrl(urls[0]) }} />
            <span className="text-xs text-slate-400">Add an icon or cover photo.</span>
          </div>
        )}
      </div>
      </>
      )}

      {/* Footer — wizard nav when adding, Save/Delete/Clone when editing. */}
      {stepped ? (
        <div className="md:col-span-2 flex items-center gap-2 pt-3 border-t border-slate-100 mt-2">
          {clampedStep > 0 && (
            <Button type="button" variant="ghost" onClick={() => setWstep(s => Math.max(0, s - 1))}>Back</Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="ml-auto">
            {isLastStep ? (
              <Button type="submit" loading={isSubmitting}>Create offering</Button>
            ) : (
              <Button
                type="button"
                onClick={async () => {
                  if (currentKey === 'start' && !(await trigger('name'))) return
                  setWstep(s => Math.min(stepKeys.length - 1, s + 1))
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 mt-2">
          <Button type="submit" loading={isSubmitting}>Save changes</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={handleClone} disabled={cloning} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {cloning ? 'Cloning…' : 'Clone'}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

/** A numbered section divider that spans the form's 2-col grid — breaks the
 * long form into clear, ordered steps without turning it into a multi-page
 * wizard (the whole thing still saves in one go). */
function SectionHeading({ step, title, hint }: { step?: number; title: string; hint?: string }) {
  return (
    <div className="md:col-span-2 flex items-center gap-3 pt-3 first:pt-0 border-t border-slate-100 first:border-0 mt-1 first:mt-0">
      {step != null && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold">{step}</span>
      )}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900 leading-tight">{title}</h2>
        {hint && <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}
